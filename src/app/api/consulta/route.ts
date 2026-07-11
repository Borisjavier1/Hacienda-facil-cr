import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  inferIdentificationType,
  isValidCedula,
  normalizeCedula,
} from "@/lib/validators";
import type { ActividadEconomica, ConsultaPayload, ConsultaResponse } from "@/types/consulta";

type CacheRow = {
  cedula: string;
  response_json: ConsultaPayload;
  fetched_at: string;
};

type MemoryCacheEntry = {
  payload: ConsultaPayload;
  cachedAt: string;
  confidence: ConsultaResponse["confidence"];
  expiresAt: number;
};

const HACIENDA_TIMEOUT_MS = 6000;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const memoryCache = new Map<string, MemoryCacheEntry>();
const inFlightRequests = new Map<string, Promise<ConsultaResponse>>();

function getMemoryCache(cedula: string) {
  const entry = memoryCache.get(cedula);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    memoryCache.delete(cedula);
    return null;
  }

  return entry;
}

function setMemoryCache(
  cedula: string,
  payload: ConsultaPayload,
  cachedAt: string,
  confidence: ConsultaResponse["confidence"],
) {
  memoryCache.set(cedula, {
    payload,
    cachedAt,
    confidence,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
  });
}

function parseRegimen(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (value && typeof value === "object" && "descripcion" in value) {
    const descripcion = (value as { descripcion?: unknown }).descripcion;
    if (typeof descripcion === "string" && descripcion.trim().length > 0) {
      return descripcion;
    }
  }

  return "No disponible";
}

function parseActivities(raw: unknown): ActividadEconomica[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const source = item as Record<string, unknown>;

      const codigoActividad =
        source.codigo ?? source.codActividad ?? source.actividad ?? source.idActividad;
      const codigoCabys =
        source.codigoCabys ?? source.cabys ?? source.codigo_cabys ?? source.codCabys;
      const descripcion =
        source.descripcion ?? source.nombre ?? source.actividad ?? source.detalle;

      return {
        codigoActividad: String(codigoActividad ?? "No disponible"),
        codigoCabys: String(codigoCabys ?? "No reportado por Hacienda"),
        descripcion: String(descripcion ?? "Sin descripcion"),
      };
    })
    .filter((activity): activity is ActividadEconomica => activity !== null);
}

function normalizeHaciendaResponse(
  cedula: string,
  rawData: Record<string, unknown>,
): ConsultaPayload {
  return {
    identificacion: cedula,
    nombre: String(
      rawData.nombre ??
        rawData.nombreComercial ??
        rawData.razonSocial ??
        rawData.nomContribuyente ??
        "No disponible",
    ),
    tipoIdentificacion: String(
      rawData.tipoIdentificacion ??
        rawData.tipoIdentificacionNombre ??
        inferIdentificationType(cedula),
    ),
    regimen: parseRegimen(rawData.regimen ?? rawData.regimenTributario),
    actividades: parseActivities(
      rawData.actividades ??
        rawData.actividadesEconomicas ??
        rawData.actividadEconomica,
    ),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cedula?: string };
    const cedula = normalizeCedula(body.cedula ?? "");

    if (!isValidCedula(cedula)) {
      return NextResponse.json(
        {
          error:
              "La cedula ingresada no tiene un formato valido. Usa solo numeros, sin guiones ni espacios.",
        },
        { status: 400 },
      );
    }

    const memoryHit = getMemoryCache(cedula);
    if (memoryHit) {
      return NextResponse.json(
        {
          source: "memory",
          confidence: memoryHit.confidence,
          cachedAt: memoryHit.cachedAt,
          data: memoryHit.payload,
        } satisfies ConsultaResponse,
        { status: 200 },
      );
    }

    const inFlight = inFlightRequests.get(cedula);
    if (inFlight) {
      const sharedResponse = await inFlight;
      return NextResponse.json(sharedResponse, {
        status: 200,
        headers: {
          "x-cache-status": "inflight-shared",
        },
      });
    }

    const consultationPromise = (async () => {
      let supabase;
      try {
        supabase = getSupabaseAdminClient();
      } catch {
        throw new Error(
          "Configuracion incompleta de Supabase. Define SUPABASE_URL y una clave admin valida.",
        );
      }

      const { data: cachedRow, error: cacheReadError } = await supabase
        .from("tax_query_cache")
        .select("cedula,response_json,fetched_at")
        .eq("cedula", cedula)
        .gte("fetched_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle<CacheRow>();

      if (cacheReadError) {
        throw new Error(`No fue posible consultar la cache en Supabase: ${cacheReadError.message}`);
      }

      if (cachedRow?.response_json) {
        setMemoryCache(
          cedula,
          cachedRow.response_json,
          cachedRow.fetched_at,
          "recent_cache",
        );

        return {
          source: "cache",
          confidence: "recent_cache",
          cachedAt: cachedRow.fetched_at,
          data: cachedRow.response_json,
        } satisfies ConsultaResponse;
      }

      const { data: staleCachedRow, error: staleCacheReadError } = await supabase
        .from("tax_query_cache")
        .select("cedula,response_json,fetched_at")
        .eq("cedula", cedula)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle<CacheRow>();

      if (staleCacheReadError) {
        throw new Error(
          `No fue posible consultar la cache historica en Supabase: ${staleCacheReadError.message}`,
        );
      }

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, HACIENDA_TIMEOUT_MS);

      let haciendaResponse: Response;
      try {
        haciendaResponse = await fetch(
          `https://api.hacienda.go.cr/fe/ae?identificacion=${cedula}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            cache: "no-store",
            signal: abortController.signal,
          },
        );
      } catch (error) {
        if (staleCachedRow?.response_json) {
          setMemoryCache(
            cedula,
            staleCachedRow.response_json,
            staleCachedRow.fetched_at,
            "unconfirmed_today",
          );

          return {
            source: "cache",
            confidence: "unconfirmed_today",
            cachedAt: staleCachedRow.fetched_at,
            data: staleCachedRow.response_json,
          } satisfies ConsultaResponse;
        }

        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            "La consulta al API de Hacienda excedio el tiempo limite. Intenta nuevamente en unos segundos.",
          );
        }

        throw new Error("No fue posible conectar con el API de Hacienda en este momento.");
      } finally {
        clearTimeout(timeoutId);
      }

      if (haciendaResponse.status === 404) {
        throw new Error("No se encontro informacion para la cedula consultada.");
      }

      if (!haciendaResponse.ok) {
        if (staleCachedRow?.response_json) {
          setMemoryCache(
            cedula,
            staleCachedRow.response_json,
            staleCachedRow.fetched_at,
            "unconfirmed_today",
          );

          return {
            source: "cache",
            confidence: "unconfirmed_today",
            cachedAt: staleCachedRow.fetched_at,
            data: staleCachedRow.response_json,
          } satisfies ConsultaResponse;
        }

        throw new Error("El servicio del Ministerio de Hacienda no esta disponible temporalmente.");
      }

      const contentType = haciendaResponse.headers.get("content-type") ?? "";
      const rawText = await haciendaResponse.text();

      // Hacienda sometimes returns an HTML page with HTTP 200 when the backend is degraded.
      if (!contentType.toLowerCase().includes("application/json")) {
        if (staleCachedRow?.response_json) {
          setMemoryCache(
            cedula,
            staleCachedRow.response_json,
            staleCachedRow.fetched_at,
            "unconfirmed_today",
          );

          return {
            source: "cache",
            confidence: "unconfirmed_today",
            cachedAt: staleCachedRow.fetched_at,
            data: staleCachedRow.response_json,
          } satisfies ConsultaResponse;
        }

        throw new Error(
          "Hacienda devolvio una respuesta no valida.",
        );
      }

      let rawPayload: Record<string, unknown>;
      try {
        rawPayload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        if (staleCachedRow?.response_json) {
          setMemoryCache(
            cedula,
            staleCachedRow.response_json,
            staleCachedRow.fetched_at,
            "unconfirmed_today",
          );

          return {
            source: "cache",
            confidence: "unconfirmed_today",
            cachedAt: staleCachedRow.fetched_at,
            data: staleCachedRow.response_json,
          } satisfies ConsultaResponse;
        }

        throw new Error(
          "Hacienda devolvio una respuesta no valida.",
        );
      }

      const normalizedPayload = normalizeHaciendaResponse(cedula, rawPayload);

      const nowIso = new Date().toISOString();

      const { error: upsertError } = await supabase.from("tax_query_cache").upsert(
        {
          cedula,
          response_json: normalizedPayload,
          fetched_at: nowIso,
        },
        { onConflict: "cedula" },
      );

      if (upsertError) {
        throw new Error(`Fallo el guardado en cache: ${upsertError.message}`);
      }

      setMemoryCache(cedula, normalizedPayload, nowIso, "real_time");

      return {
        source: "hacienda",
        confidence: "real_time",
        cachedAt: nowIso,
        data: normalizedPayload,
      } satisfies ConsultaResponse;
    })();

    inFlightRequests.set(cedula, consultationPromise);

    try {
      const response = await consultationPromise;
      return NextResponse.json(response, { status: 200 });
    } finally {
      inFlightRequests.delete(cedula);
    }
  } catch (unknownError) {
    if (unknownError instanceof Error) {
      if (unknownError.message.includes("No se encontro informacion")) {
        return NextResponse.json(
          {
            error:
              "No encontramos esa cedula en el registro consultado de Hacienda.",
          },
          { status: 404 },
        );
      }

      if (unknownError.message.includes("excedio el tiempo limite")) {
        return NextResponse.json(
          {
            error:
              "No pudimos confirmar si la cedula esta registrada porque Hacienda no respondio a tiempo.",
          },
          { status: 504 },
        );
      }

      if (
        unknownError.message.includes("No fue posible conectar") ||
        unknownError.message.includes("no esta disponible") ||
        unknownError.message.includes("Hacienda respondio con formato invalido") ||
        unknownError.message.includes("Hacienda devolvio una respuesta invalida")
      ) {
        return NextResponse.json(
          {
            error:
              "No pudimos confirmar el estado de la cedula porque Hacienda esta inestable en este momento.",
          },
          { status: 503 },
        );
      }

      if (
        unknownError.message.includes("cache") ||
        unknownError.message.includes("Supabase")
      ) {
        return NextResponse.json(
          {
            error:
              "Tuvimos un problema temporal procesando la consulta. Intenta nuevamente.",
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json(
      {
        error:
          "Error inesperado procesando la solicitud. Verifica el formato e intenta de nuevo.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      message:
        "Este endpoint usa POST. Envia JSON con { \"cedula\": \"3101123456\" }.",
    },
    { status: 200 },
  );
}
