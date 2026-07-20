import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { describe, expect, test, vi } from "vitest";
import { ROLES_KEY } from "../../auth/auth.module";
import { BdcPricingController } from "./bdc-pricing.controller";
import type { BdcPricingService } from "./bdc-pricing.service";

function setup() {
  const service = {
    createRun: vi.fn(async () => ({ id: "run-1", status: "queued" })),
    getLatestRun: vi.fn(async () => ({ id: "run-1" })),
    getRun: vi.fn(async () => ({ id: "run-1" })),
    cancelRun: vi.fn(async () => ({ id: "run-1", status: "cancelled" })),
    applyRun: vi.fn(async () => ({ statut: "brouillon" })),
    recordFeedback: vi.fn(async () => undefined),
  } as unknown as BdcPricingService;
  return { controller: new BdcPricingController(service), service };
}

describe("BdcPricingController", () => {
  test("creates an accepted idempotent pricing run for the authenticated actor", async () => {
    const { controller, service } = setup();
    await expect(
      controller.createRun(
        "avis-1",
        { "idempotency-key": "request-42" },
        { requestedMarkupPct: 18 },
        { user: { sub: "user-7" } },
      ),
    ).resolves.toMatchObject({ id: "run-1", status: "queued" });
    expect(service.createRun).toHaveBeenCalledWith("avis-1", {
      idempotencyKey: "request-42",
      requestedMarkupPct: 18,
      actorId: "user-7",
    });
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        BdcPricingController.prototype.createRun,
      ),
    ).toBe(HttpStatus.ACCEPTED);
  });

  test("requires an idempotency key and validates the requested markup", async () => {
    const { controller } = setup();
    await expect(
      controller.createRun("avis-1", {}, {}, { user: { sub: "user-7" } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createRun(
        "avis-1",
        { "idempotency-key": "request-42" },
        { requestedMarkupPct: 2 },
        { user: { sub: "user-7" } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test("validates feedback before recording learning evidence", async () => {
    const { controller, service } = setup();
    await expect(
      controller.feedback("run-1", { kind: "unknown" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await controller.feedback("run-1", {
      lineIdx: 3,
      kind: "actual_cost",
      actualCostHtMad: 120,
      verified: true,
      note: "Facture finale",
    });
    expect(service.recordFeedback).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        lineIdx: 3,
        kind: "actual_cost",
        actualCostHtMad: 120,
        verified: true,
      }),
    );
  });

  test("preserves not-found and conflict semantics from the service", async () => {
    const { controller, service } = setup();
    vi.mocked(service.getRun).mockRejectedValueOnce(
      new NotFoundException("Chiffrage introuvable"),
    );
    vi.mocked(service.applyRun).mockRejectedValueOnce(
      new ConflictException("Le chiffrage doit être terminé"),
    );
    await expect(controller.getRun("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.apply("running")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  test("restricts all mutations to procurement administrators", () => {
    for (const method of ["createRun", "cancel", "apply", "feedback"] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, BdcPricingController.prototype[method]),
      ).toEqual(["direction", "marches", "admin-si"]);
    }
  });
});
