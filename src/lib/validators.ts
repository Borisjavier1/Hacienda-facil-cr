const SUPPORTED_LENGTHS = new Set([9, 10, 11, 12]);

export function normalizeCedula(input: string) {
  return input.replace(/\D/g, "");
}

export function isValidCedula(input: string) {
  const normalized = normalizeCedula(input);
  return SUPPORTED_LENGTHS.has(normalized.length);
}

export function inferIdentificationType(cedula: string) {
  const length = cedula.length;

  if (length === 9) {
    return "Fisica";
  }

  if (length === 10) {
    return "Juridica";
  }

  return "DIMEX/Otro";
}
