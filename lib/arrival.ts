export const ARRIVAL_DISTANCE_METERS = 25;
export const ARRIVAL_MAX_ACCURACY_METERS = 50;

export function isArrived(distance?: number, accuracy?: number) {
  return (
    typeof distance === "number" &&
    Number.isFinite(distance) &&
    distance <= ARRIVAL_DISTANCE_METERS &&
    (typeof accuracy !== "number" || accuracy <= ARRIVAL_MAX_ACCURACY_METERS)
  );
}
