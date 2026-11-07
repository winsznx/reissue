import { eq } from "drizzle-orm";

import { newId, schema, type Database } from "@reissue/db";

import type { AppConfig } from "./config.js";

export type RoomBinding = typeof schema.roomBindings.$inferSelect;
export type Tenant = typeof schema.tenants.$inferSelect;

/** Local deployments run one workspace; the id is stable so restarts and seeds agree. */
export const DEFAULT_TENANT_ID = "ten_default";

export async function ensureTenant(db: Database, name: string): Promise<Tenant> {
  await db.insert(schema.tenants).values({ id: DEFAULT_TENANT_ID, name }).onConflictDoNothing();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, DEFAULT_TENANT_ID));
  return tenant!;
}

/**
 * Seeds room bindings from environment room ids so no room identifier is hard-coded.
 * Existing bindings for the same Switch room keep their settings.
 */
export async function seedRoomBindings(db: Database, config: AppConfig, tenantId: string): Promise<void> {
  const seeds = [
    { roomId: config.SWITCH_OPS_ROOM_ID, platform: config.SWITCH_OPS_PLATFORM, intent: "OPERATIONS" as const, label: "shipment-ops", sensitive: true },
    { roomId: config.SWITCH_SUPPLIER_ROOM_ID, platform: config.SWITCH_SUPPLIER_PLATFORM, intent: "SUPPLIER" as const, label: "supplier-corrections", sensitive: false },
    { roomId: config.SWITCH_VERIFICATION_ROOM_ID, platform: config.SWITCH_VERIFICATION_PLATFORM, intent: "VERIFICATION" as const, label: "reissue-verification", sensitive: true },
  ];
  for (const seed of seeds) {
    if (!seed.roomId) continue;
    await db
      .insert(schema.roomBindings)
      .values({
        id: newId("room"),
        tenantId,
        switchRoomId: seed.roomId,
        platform: seed.platform,
        intent: seed.intent,
        label: seed.label,
        canReceiveSensitive: seed.sensitive,
      })
      .onConflictDoNothing({ target: schema.roomBindings.switchRoomId });
  }
}

export async function listBindings(db: Database, tenantId: string): Promise<RoomBinding[]> {
  return db.select().from(schema.roomBindings).where(eq(schema.roomBindings.tenantId, tenantId));
}

export async function bindingForRoom(db: Database, roomId: string): Promise<RoomBinding | null> {
  const [row] = await db.select().from(schema.roomBindings).where(eq(schema.roomBindings.switchRoomId, roomId));
  return row ?? null;
}

const CONFIGURED_ROOM = {
  OPERATIONS: "SWITCH_OPS_ROOM_ID",
  SUPPLIER: "SWITCH_SUPPLIER_ROOM_ID",
  VERIFICATION: "SWITCH_VERIFICATION_ROOM_ID",
} as const satisfies Record<RoomBinding["intent"], keyof AppConfig>;

/**
 * The room for an intent, preferring the one set in config. Rebinding a room (connect-rooms)
 * keeps the previous room's binding, so without the preference an old room could win.
 */
export async function primaryRoom(db: Database, config: AppConfig, tenantId: string, intent: RoomBinding["intent"]): Promise<RoomBinding | null> {
  const rows = (await listBindings(db, tenantId)).filter((r) => r.intent === intent);
  return rows.find((r) => r.switchRoomId === config[CONFIGURED_ROOM[intent]]) ?? rows[0] ?? null;
}
