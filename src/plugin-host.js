import { z } from 'zod';

export class PluginHost {
  constructor() {
    this.plugins = [];
    this.toolMap = new Map();
    this.ipcMap = new Map();
    this.unscopedTools = new Set();
  }

  register(plugin) {
    if (!plugin || typeof plugin.id !== 'string' || !plugin.id) {
      throw new Error('Plugin requires a non-empty string id.');
    }
    if (this.plugins.some(p => p.id === plugin.id)) {
      throw new Error('Duplicate plugin id: ' + plugin.id);
    }
    this.plugins.push(plugin);
    for (const tool of plugin.tools ?? []) {
      const [name, description, schema, mutation, handler, options = {}] = tool;
      if (this.toolMap.has(name)) throw new Error('Duplicate plugin tool: ' + name);
      this.toolMap.set(name, {
        definition: [name, description, schema, Boolean(mutation)],
        validator: z.object(schema).strict(),
        handler,
        options,
        pluginId: plugin.id,
      });
      if (options.unscoped) this.unscopedTools.add(name);
    }
    for (const [command, handler] of Object.entries(plugin.ipcHandlers ?? {})) {
      if (this.ipcMap.has(command)) throw new Error('Duplicate plugin IPC handler: ' + command);
      this.ipcMap.set(command, handler);
    }
    return this;
  }

  ids() {
    return this.plugins.map(p => p.id);
  }

  enabledPanels() {
    const panels = [];
    for (const plugin of this.plugins) {
      for (const panel of plugin.uiPanels ?? []) panels.push(panel);
    }
    return panels;
  }

  toolDefinitions() {
    return [...this.toolMap.values()].map(item => item.definition);
  }

  isUnscoped(toolName) {
    return this.unscopedTools.has(toolName);
  }

  hasTool(toolName) {
    return this.toolMap.has(toolName);
  }

  async dispatchTool(engine, name, args, client) {
    const entry = this.toolMap.get(name);
    if (!entry) return { handled: false };
    const result = await entry.handler(engine, args, client);
    return { handled: true, result };
  }

  hasIpc(command) {
    return this.ipcMap.has(command);
  }

  async handleIpc(command, payload, ctx) {
    const handler = this.ipcMap.get(command);
    if (!handler) return { handled: false };
    const result = await handler(payload, ctx);
    return { handled: true, result };
  }

  healthFlags() {
    const flags = {};
    for (const plugin of this.plugins) {
      Object.assign(flags, plugin.healthFlags ?? {});
    }
    return flags;
  }

  describeTab(engine, tab) {
    const extra = {};
    for (const plugin of this.plugins) {
      if (typeof plugin.describeTab === 'function') {
        Object.assign(extra, plugin.describeTab(engine, tab) || {});
      }
    }
    return extra;
  }

  describeState(engine) {
    const extra = {};
    for (const plugin of this.plugins) {
      if (typeof plugin.describeState === 'function') {
        Object.assign(extra, plugin.describeState(engine) || {});
      }
    }
    return extra;
  }

  onEngineInit(engine) {
    for (const plugin of this.plugins) {
      plugin.onEngineInit?.(engine);
    }
  }

  onPause(engine, reason) {
    for (const plugin of this.plugins) {
      plugin.onPause?.(engine, reason);
    }
  }

  onResume(engine) {
    for (const plugin of this.plugins) {
      plugin.onResume?.(engine);
    }
  }

  onBeforeQuit(engine) {
    for (const plugin of this.plugins) {
      plugin.onBeforeQuit?.(engine);
    }
  }
}
