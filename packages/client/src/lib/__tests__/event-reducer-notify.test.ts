import { describe, expect, it } from "vitest";
import { addInteractiveRequest, createInitialState } from "../event-reducer.js";

describe("event reducer notify requests", () => {
  it("does not dedupe repeated notify messages by title", () => {
    const first = addInteractiveRequest(
      createInitialState(),
      "notify-1",
      "notify",
      { title: "[Plannotator] http://localhost:19432" },
    );
    const second = addInteractiveRequest(
      first,
      "notify-2",
      "notify",
      { title: "[Plannotator] http://localhost:19432" },
    );

    expect(second.interactiveRequests.map((r) => r.requestId)).toEqual(["notify-1", "notify-2"]);
    expect(second.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(2);
  });

  it("still dedupes pending dialogs by title", () => {
    const first = addInteractiveRequest(
      createInitialState(),
      "select-1",
      "select",
      { title: "Pick", options: ["a", "b"] },
    );
    const second = addInteractiveRequest(
      first,
      "select-2",
      "select",
      { title: "Pick", options: ["a", "b"] },
    );

    expect(second.interactiveRequests.map((r) => r.requestId)).toEqual(["select-1"]);
  });
});
