import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("Utility functions", () => {
  it("should merge tailwind classes correctly", () => {
    const result = cn("p-2 bg-red-500", "bg-blue-500");
    expect(result).toContain("bg-blue-500");
  });
});