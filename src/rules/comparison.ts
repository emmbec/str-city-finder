export type NumericOperator = "less_than" | "less_than_or_equal" | "greater_than_or_equal";

export function compareNumber(observed: number, operator: NumericOperator, expected: number): boolean {
  switch (operator) {
    case "less_than": return observed < expected;
    case "less_than_or_equal": return observed <= expected;
    case "greater_than_or_equal": return observed >= expected;
  }
}
