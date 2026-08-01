import { describe, expect, it } from "vitest";
import { createColumn, createEntity } from "../../core/model/factory";
import { filterEntityNavigatorResults } from "../entityNavigatorSearch";

const entities = [
  createEntity({
    name: "customers",
    columns: [
      createColumn({ name: "id", type: "uuid" }),
      createColumn({ name: "billing_email", type: "text" }),
    ],
  }),
  createEntity({
    name: "orders",
    columns: [
      createColumn({ name: "id", type: "uuid" }),
      createColumn({ name: "customer_id", type: "uuid" }),
    ],
  }),
];

describe("filterEntityNavigatorResults", () => {
  it("테이블 이름으로 검색한다", () => {
    expect(filterEntityNavigatorResults(entities, "ORDER").map((result) => result.entity.name))
      .toEqual(["orders"]);
  });

  it("컬럼 이름으로 테이블을 찾고 일치 컬럼을 보존한다", () => {
    const results = filterEntityNavigatorResults(entities, "billing");

    expect(results).toHaveLength(1);
    expect(results[0].entity.name).toBe("customers");
    expect(results[0].matchingColumns).toEqual(["billing_email"]);
  });
});
