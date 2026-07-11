export type ActividadEconomica = {
  codigoActividad: string;
  codigoCabys: string;
  descripcion: string;
};

export type ConsultaPayload = {
  identificacion: string;
  nombre: string;
  tipoIdentificacion: string;
  regimen: string;
  actividades: ActividadEconomica[];
};

export type ConsultaResponse = {
  source: "memory" | "cache" | "hacienda";
  confidence: "real_time" | "recent_cache" | "unconfirmed_today";
  cachedAt: string | null;
  data: ConsultaPayload;
};
