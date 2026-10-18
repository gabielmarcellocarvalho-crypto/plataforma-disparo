import { describe, expect, it } from "vitest";
import { parseDeliveryStatuses } from "@/lib/message-statuses";

describe("parseDeliveryStatuses", () => {
  it("pega só entregue e lida", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.1", status: "sent", timestamp: "1760000000" },
                  { id: "wamid.1", status: "delivered", timestamp: "1760000010" },
                  { id: "wamid.2", status: "read", timestamp: "1760000020" },
                  { status: "read" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseDeliveryStatuses(body)).toEqual([
      { id: "wamid.1", status: "delivered", at: new Date(1760000010 * 1000).toISOString() },
      { id: "wamid.2", status: "read", at: new Date(1760000020 * 1000).toISOString() },
    ]);
  });
  it("corpo sem status", () => {
    expect(parseDeliveryStatuses(null)).toEqual([]);
    expect(parseDeliveryStatuses({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });
});
