import * as Loader from "./loader"
import * as Schema from "./schema"

export namespace Config {
  // ── Schemas & Types ──────────────────────────────────────────────────
  export const McpLocal = Schema.McpLocal
  export const McpOAuth = Schema.McpOAuth
  export type McpOAuth = Schema.McpOAuth
  export const McpRemote = Schema.McpRemote
  export const Mcp = Schema.Mcp
  export type Mcp = Schema.Mcp

  export const PermissionAction = Schema.PermissionAction
  export type PermissionAction = Schema.PermissionAction
  export const PermissionObject = Schema.PermissionObject
  export type PermissionObject = Schema.PermissionObject
  export const PermissionRule = Schema.PermissionRule
  export type PermissionRule = Schema.PermissionRule
  export const Permission = Schema.Permission
  export type Permission = Schema.Permission

  export const Command = Schema.Command
  export type Command = Schema.Command
  export const Skills = Schema.Skills
  export type Skills = Schema.Skills
  export const Agent = Schema.Agent
  export type Agent = Schema.Agent

  export const Keybinds = Schema.Keybinds
  export const Server = Schema.Server
  export const Layout = Schema.Layout
  export type Layout = Schema.Layout
  export const Provider = Schema.Provider
  export type Provider = Schema.Provider

  export const Info = Schema.Info
  export type Info = Schema.Info

  export const ConfigDirectoryTypoError = Schema.ConfigDirectoryTypoError

  export const schema = Schema.schema

  // ── Loader & Config API ──────────────────────────────────────────────
  export const state = Loader.state
  export const global = Loader.global
  export const readFile = Loader.readFile
  export const managedConfigDir = Loader.managedConfigDir
  export const JsonError = Loader.JsonError
  export const InvalidError = Loader.InvalidError

  export function get() {
    return Loader.get()
  }
  export function getGlobal() {
    return Loader.getGlobal()
  }
  export function update(config: Schema.Info) {
    return Loader.update(config)
  }
  export function updateGlobal(config: Schema.Info) {
    return Loader.updateGlobal(config)
  }
  export function directories() {
    return Loader.directories()
  }
  export function pluginSkills() {
    return Loader.pluginSkills()
  }
}
