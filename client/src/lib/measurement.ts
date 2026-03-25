/** User/company preference for how distances and related labels are shown. Internal math can stay in km where the app already uses it. */
export type MeasurementUnit = "metric" | "imperial";

export type WorkspaceMeasurementFields = {
  measurementUnit?: string;
};

export function resolveMeasurementUnit(
  fields: WorkspaceMeasurementFields | null | undefined
): MeasurementUnit {
  const u = fields?.measurementUnit;
  if (u === "metric" || u === "imperial") return u;
  return "imperial";
}

export const KM_PER_MILE = 1.609344;

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}
