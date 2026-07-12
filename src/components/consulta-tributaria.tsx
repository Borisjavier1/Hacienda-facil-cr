"use client";

import { FormEvent, useMemo, useState } from "react";
import { Building2, FileSearch, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeCedula } from "@/lib/validators";
import type { ConsultaResponse } from "@/types/consulta";

type LocalHistoryItem = {
  cedula: string;
  nombre: string;
  whenIso: string;
  confidence: ConsultaResponse["confidence"];
};

type LocalMetrics = {
  successCount: number;
  unconfirmedCount: number;
};

const HISTORY_KEY = "hfcr_recent_history_v1";
const METRICS_KEY = "hfcr_metrics_v1";
const ADS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_AD_SLOTS === "true";

function loadStoredHistory(): LocalHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? (JSON.parse(stored) as LocalHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function loadStoredMetrics(): LocalMetrics {
  if (typeof window === "undefined") {
    return { successCount: 0, unconfirmedCount: 0 };
  }

  try {
    const stored = localStorage.getItem(METRICS_KEY);
    return stored
      ? (JSON.parse(stored) as LocalMetrics)
      : { successCount: 0, unconfirmedCount: 0 };
  } catch {
    return { successCount: 0, unconfirmedCount: 0 };
  }
}

type ViewState = {
  loading: boolean;
  error: string | null;
  statusCode: number | null;
  result: ConsultaResponse | null;
};

export function ConsultaTributaria() {
  const [cedula, setCedula] = useState("");
  const [history, setHistory] = useState<LocalHistoryItem[]>(() => loadStoredHistory());
  const [metrics, setMetrics] = useState<LocalMetrics>(() => loadStoredMetrics());
  const [state, setState] = useState<ViewState>({
    loading: false,
    error: null,
    statusCode: null,
    result: null,
  });

  const normalizedCedula = useMemo(() => normalizeCedula(cedula), [cedula]);
  const sourceLabel =
    state.result?.source === "hacienda"
      ? "Hacienda en tiempo real"
      : state.result?.source === "memory"
        ? "cache ultrarapida"
        : "cache Supabase";

  const confidenceLabel =
    state.result?.confidence === "real_time"
      ? "Dato en tiempo real"
      : state.result?.confidence === "recent_cache"
        ? "Dato en cache reciente"
        : state.result?.confidence === "unconfirmed_today"
          ? "No se pudo confirmar hoy"
          : "";

  const persistHistory = (nextHistory: LocalHistoryItem[]) => {
    setHistory(nextHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
  };

  const persistMetrics = (nextMetrics: LocalMetrics) => {
    setMetrics(nextMetrics);
    localStorage.setItem(METRICS_KEY, JSON.stringify(nextMetrics));
  };

  const trackSuccess = (confidence: ConsultaResponse["confidence"]) => {
    const nextMetrics: LocalMetrics = {
      successCount: metrics.successCount + (confidence === "unconfirmed_today" ? 0 : 1),
      unconfirmedCount: metrics.unconfirmedCount + (confidence === "unconfirmed_today" ? 1 : 0),
    };
    persistMetrics(nextMetrics);
  };

  const trackUnconfirmedError = () => {
    const nextMetrics: LocalMetrics = {
      successCount: metrics.successCount,
      unconfirmedCount: metrics.unconfirmedCount + 1,
    };
    persistMetrics(nextMetrics);
  };

  const saveHistoryItem = (result: ConsultaResponse) => {
    const entry: LocalHistoryItem = {
      cedula: result.data.identificacion,
      nombre: result.data.nombre,
      whenIso: new Date().toISOString(),
      confidence: result.confidence,
    };

    const nextHistory = [entry, ...history.filter((item) => item.cedula !== entry.cedula)].slice(0, 20);
    persistHistory(nextHistory);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch("/api/consulta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cedula: normalizedCedula }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setState({
          loading: false,
          error: payload.error ?? "Error inesperado",
          statusCode: response.status,
          result: null,
        });

        if (response.status === 503 || response.status === 504) {
          trackUnconfirmedError();
        }

        return;
      }

      setState({ loading: false, error: null, statusCode: null, result: payload });
      saveHistoryItem(payload as ConsultaResponse);
      trackSuccess((payload as ConsultaResponse).confidence);
    } catch {
      setState({
        loading: false,
        error:
          "No fue posible completar la consulta en este momento. Intenta nuevamente en unos minutos.",
        statusCode: null,
        result: null,
      });
    }
  };

  const onUseHistory = (historyCedula: string) => {
    setCedula(historyCedula);
  };

  const onRemoveHistoryItem = (historyCedula: string) => {
    const nextHistory = history.filter((item) => item.cedula !== historyCedula);
    persistHistory(nextHistory);
  };

  const onCopySummary = async () => {
    if (!state.result) {
      return;
    }

    const resumen = [
      `Contribuyente: ${state.result.data.nombre}`,
      `Cedula: ${state.result.data.identificacion}`,
      `Tipo: ${state.result.data.tipoIdentificacion}`,
      `Regimen: ${state.result.data.regimen}`,
      `Confianza: ${confidenceLabel}`,
      "Actividades:",
      ...state.result.data.actividades.map(
        (actividad) => `- ${actividad.descripcion} | Actividad ${actividad.codigoActividad} | CAByS ${actividad.codigoCabys}`,
      ),
    ].join("\n");

    await navigator.clipboard.writeText(resumen);
  };

  const onExportPdf = () => {
    window.print();
  };

  const onClear = () => {
    setCedula("");
    setState({
      loading: false,
      error: null,
      statusCode: null,
      result: null,
    });
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 lg:py-14">
      <section className="glass-surface overflow-hidden rounded-3xl p-6 shadow-[0_20px_40px_rgba(13,148,136,0.12)] sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">
              <Building2 className="h-3.5 w-3.5" />
              Hacienda Fácil CR
            </div>
            <h1 className="font-[var(--font-space-grotesk)] text-3xl font-semibold leading-tight text-slate-900 sm:text-5xl">
              Consulta tributaria y codigos CAByS en segundos
            </h1>
            <p className="mt-4 max-w-2xl text-sm text-[var(--muted-ink)] sm:text-base">
              Ingresa una cedula fisica, juridica o DIMEX para obtener informacion oficial del Ministerio de Hacienda.
              El sistema reutiliza cache de 24 horas para ahorrar tiempo y peticiones.
            </p>
            <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
              <Input
                value={cedula}
                onChange={(event) => setCedula(event.target.value)}
                placeholder="Ejemplo: 3101123456"
                inputMode="numeric"
                className="sm:max-w-lg"
                aria-label="Cedula del contribuyente"
              />
              <Button type="submit" size="lg" disabled={state.loading}>
                {state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                <span className="ml-2">Consultar</span>
              </Button>
              <Button type="button" size="lg" variant="secondary" onClick={onClear}>
                Limpiar
              </Button>
            </form>
            {state.error ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium text-red-700">{state.error}</p>
                {state.statusCode === 504 ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                    No pudimos confirmar si esta cedula existe porque Hacienda no respondio a tiempo. Tu dato sigue en el input para reintentar.
                  </p>
                ) : null}
                {state.statusCode === 400 ? (
                  <p className="rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-900">
                    Tip: ingresa solo numeros, sin guiones ni espacios.
                  </p>
                ) : null}
                {state.statusCode === 503 ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                    El servicio de Hacienda esta inestable y no pudimos confirmar el estado de esta cedula.
                  </p>
                ) : null}
              </div>
            ) : null}

            {!ADS_ENABLED ? (
              <p className="mt-4 text-xs font-medium text-slate-500">
                Espacios publicitarios en preparacion. Esta version prioriza velocidad y experiencia de consulta.
              </p>
            ) : null}
          </div>

          {ADS_ENABLED ? (
            <aside className="grid grid-rows-2 gap-4">
              <div className="rounded-2xl border border-dashed border-teal-200 bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-700">Espacio AdSense</p>
                <p className="mt-2 text-sm text-slate-500">Placeholder visual 300x250 para anuncio futuro.</p>
              </div>
              <div className="rounded-2xl border border-dashed border-cyan-200 bg-cyan-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-cyan-700">Espacio Promocional</p>
                <p className="mt-2 text-sm text-slate-500">Zona secundaria para banner o patrocinador.</p>
              </div>
            </aside>
          ) : null}
        </div>
      </section>

      <section className="order-3 grid gap-5 md:order-none md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Historial local reciente</CardTitle>
            <CardDescription>Guardado en este navegador, sin login.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-[var(--muted-ink)]">Aun no hay consultas guardadas en este dispositivo.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {history.map((item) => (
                  <li key={`${item.cedula}-${item.whenIso}`} className="flex items-center justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50/40 px-3 py-2">
                    <div>
                      <p className="font-semibold text-slate-900">{item.cedula}</p>
                      <p className="text-xs text-slate-600">{item.nombre}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="default" variant="secondary" onClick={() => onUseHistory(item.cedula)}>
                        Usar
                      </Button>
                      <Button type="button" size="default" variant="secondary" onClick={() => onRemoveHistoryItem(item.cedula)}>
                        Quitar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Analitica simple</CardTitle>
            <CardDescription>Conteo local de resultados de consulta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              Consultas exitosas: <strong>{metrics.successCount}</strong>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              No confirmadas hoy: <strong>{metrics.unconfirmedCount}</strong>
            </div>
          </CardContent>
        </Card>
      </section>

      {state.result ? (
        <section className="order-2 grid gap-5 md:order-none md:grid-cols-2">
          <Card className="transition-transform duration-300 hover:-translate-y-1">
            <CardHeader>
              <CardTitle>{state.result.data.nombre}</CardTitle>
              <CardDescription>Contribuyente consultado desde {sourceLabel}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Cedula: {state.result.data.identificacion}</Badge>
                <Badge>Tipo: {state.result.data.tipoIdentificacion}</Badge>
                <Badge>Regimen: {state.result.data.regimen}</Badge>
                <Badge variant="outline">{confidenceLabel}</Badge>
              </div>
              {state.result.cachedAt ? (
                <p className="text-xs text-[var(--muted-ink)]">
                  Cache valido hasta 24h. Ultima actualizacion: {new Date(state.result.cachedAt).toLocaleString("es-CR")}
                </p>
              ) : null}
            </CardContent>
            <CardFooter className="gap-2">
              <Button type="button" variant="secondary" onClick={onCopySummary}>
                Copiar resumen
              </Button>
              <Button type="button" variant="secondary" onClick={onExportPdf}>
                Exportar PDF
              </Button>
            </CardFooter>
          </Card>

          <Card className="transition-transform duration-300 hover:-translate-y-1">
            <CardHeader>
              <CardTitle>Actividades economicas</CardTitle>
              <CardDescription>Listado de actividades y sus codigos CAByS.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {state.result.data.actividades.length === 0 ? (
                  <li className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                    El contribuyente no reporta actividades economicas en la respuesta.
                  </li>
                ) : (
                  state.result.data.actividades.map((actividad, index) => (
                    <li
                      key={`${actividad.codigoActividad}-${actividad.codigoCabys}-${index}`}
                      className="rounded-xl border border-teal-100 bg-teal-50/40 p-3"
                    >
                      <p className="font-semibold text-slate-900">{actividad.descripcion}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Actividad: {actividad.codigoActividad} | CAByS: {actividad.codigoCabys === "No disponible" ? "No reportado por Hacienda" : actividad.codigoCabys}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
