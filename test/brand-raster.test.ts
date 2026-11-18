import { describe, expect, it } from "vitest"
import { coverage, flatten } from "../scripts/brand/raster.ts"

describe("the brand rasterizer's path parser", () => {
  it("draws the commands it supports", () => {
    expect(flatten("M12 56A4 4 0 0 0 8 52V40H12Z")).toHaveLength(1)
    expect(flatten("M0 0H10V10H0ZM20 0h10v10h-10z")).toHaveLength(2)
    expect(flatten("M0 0Q5 5 10 0C10 5 5 10 0 10Z")).toHaveLength(1)
    expect(flatten("M0,0 L10,0 L10,10 Z")[0]).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it("refuses arc flags written without separators", () => {
    expect(() => flatten("M12 56A4 4 0 008 52V40H12Z")).toThrow(/arc flag must be 0 or 1/)
    expect(() => flatten("M12 56A4 4 0 01 8 52V40H12Z")).toThrow(/arc flag must be 0 or 1/)
  })

  it("refuses a subpath that continues after Z without M", () => {
    expect(() => flatten("M0 0H10V10H0ZL20 0V10Z")).toThrow(/continues after Z/)
    expect(() => flatten("M0 0H10V10H0zh5v5z")).toThrow(/continues after Z/)
  })

  it("refuses commands, characters and numbers it cannot place", () => {
    expect(() => flatten("M0 0S1 1 2 2Z")).toThrow(/unsupported command S/)
    expect(() => flatten("M0 0T5 5Z")).toThrow(/unsupported command T/)
    expect(() => flatten("M0 0L5 #Z")).toThrow(/unexpected "#"/)
    expect(() => flatten("M0 0L5Z")).toThrow(/L needs a number/)
    expect(() => flatten("M0 0H10V10Z 5 5")).toThrow(/no command before it/)
    expect(() => flatten("0 0H10")).toThrow(/no command before it/)
  })
})

describe("the brand rasterizer's coverage", () => {
  it("fills a pixel-aligned square fully and nothing outside it", () => {
    const cov = coverage(flatten("M1 1H3V3H1Z"), 4, 4, "nonzero")
    expect(Array.from(cov)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0])
  })

  it("half-covers a column cut down the middle", () => {
    const cov = coverage(flatten("M0 0H1.5V2H0Z"), 2, 2, "nonzero")
    expect(Array.from(cov)).toEqual([1, 0.5, 1, 0.5])
  })

  it("leaves an even-odd hole empty and fills it under nonzero", () => {
    const ring = "M0 0H3V3H0ZM1 1H2V2H1Z"
    expect(coverage(flatten(ring), 3, 3, "evenodd")[4]).toBe(0)
    expect(coverage(flatten(ring), 3, 3, "nonzero")[4]).toBe(1)
  })
})
