import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const rooms = sqliteTable("rooms", { code: text("code").primaryKey(), state: text("state").notNull(), revision: integer("revision").notNull(), expires: integer("expires").notNull() });
export const sessions = sqliteTable("sessions", { hash: text("hash").primaryKey(), code: text("code").notNull(), player: text("player").notNull(), expires: integer("expires").notNull() });
export const limits = sqliteTable("limits", { key: text("key").primaryKey(), count: integer("count").notNull(), expires: integer("expires").notNull() });
export const cache = sqliteTable("cache", { key: text("key").primaryKey(), value: text("value").notNull(), expires: integer("expires").notNull() });
export const recent = sqliteTable("recent", { key: text("key").primaryKey(), used: integer("used").notNull() });
