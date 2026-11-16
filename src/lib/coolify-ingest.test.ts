import { describe, it, expect } from "vitest";
import { mapCoolifyEvent } from "./coolify-ingest";

describe("mapCoolifyEvent — Status-Mapping", () => {
  it.each(["server_unreachable"])("%s → DOWN", (event) => {
    expect(mapCoolifyEvent({ event, success: false }).status).toBe("DOWN");
  });

  it.each([
    "high_disk_usage",
    "container_stopped",
    "docker_cleanup_failed",
    "traefik_version_outdated",
    "server_patch_check_error",
  ])("%s → DEGRADED", (event) => {
    expect(mapCoolifyEvent({ event, success: false }).status).toBe("DEGRADED");
  });

  it.each([
    "server_reachable",
    "container_restarted",
    "docker_cleanup_success",
    "server_patch_check",
    "test",
  ])("%s → UP", (event) => {
    expect(mapCoolifyEvent({ event, success: true }).status).toBe("UP");
  });

  it.each([
    "deployment_success",
    "deployment_failed",
    "status_changed",
    "restart_limit_reached",
    "backup_success",
    "backup_failed",
    "backup_success_with_s3_warning",
    "task_success",
    "task_failed",
  ])("%s (App-/Dienst-Event) → ignoriert (null)", (event) => {
    expect(mapCoolifyEvent({ event, success: false }).status).toBeNull();
  });

  it("unbekanntes Event: success → UP, sonst DEGRADED", () => {
    expect(mapCoolifyEvent({ event: "some_future_event", success: true }).status).toBe("UP");
    expect(mapCoolifyEvent({ event: "some_future_event", success: false }).status).toBe("DEGRADED");
  });
});

describe("mapCoolifyEvent — summary", () => {
  it("nimmt message, fällt auf event zurück", () => {
    expect(mapCoolifyEvent({ event: "server_unreachable", message: "Host weg" }).summary).toBe("Host weg");
    expect(mapCoolifyEvent({ event: "server_unreachable" }).summary).toBe("server_unreachable");
    expect(mapCoolifyEvent({}).summary).toBe("Coolify-Event");
  });
});

describe("mapCoolifyEvent — eventKey (Idempotenz)", () => {
  it("identische Retries → identischer Key", () => {
    const body = { event: "server_unreachable", message: "weg", server_uuid: "abc" };
    expect(mapCoolifyEvent(body).eventKey).toBe(mapCoolifyEvent({ ...body }).eventKey);
  });

  it("unterschiedliche uuid/message → unterschiedlicher Key", () => {
    const a = mapCoolifyEvent({ event: "server_unreachable", message: "weg", server_uuid: "abc" });
    const b = mapCoolifyEvent({ event: "server_unreachable", message: "weg", server_uuid: "xyz" });
    const c = mapCoolifyEvent({ event: "server_unreachable", message: "anders", server_uuid: "abc" });
    expect(a.eventKey).not.toBe(b.eventKey);
    expect(a.eventKey).not.toBe(c.eventKey);
  });

  it("bevorzugt deployment_uuid vor server_uuid in der Reihenfolge", () => {
    const key = mapCoolifyEvent({ event: "x", deployment_uuid: "dep", server_uuid: "srv" }).eventKey;
    expect(key).toContain("dep");
    expect(key).not.toContain("srv");
  });
});
