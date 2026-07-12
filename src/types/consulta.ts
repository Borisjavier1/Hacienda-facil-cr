export type ActividadEconomica = {
  codigoActividad: string;
  codigoCabys: string;
  descripcion: string;
  estado?: string;
  tipo?: string;
};

export type SituacionTributaria = {
  moroso: string;
  omiso: string;
  estado: string;
  administracionTributaria: string;
  mensaje?: string;
};

export type ConsultaPayload = {
  identificacion: string;
  nombre: string;
  tipoIdentificacion: string;
  regimen: string;
  situacion?: SituacionTributaria;
  actividades: ActividadEconomica[];
};

export type ConsultaResponse = {
  source: "memory" | "cache" | "hacienda";
  confidence: "real_time" | "recent_cache" | "unconfirmed_today";
  cachedAt: string | null;
  data: ConsultaPayload;
};
