(() => {
  "use strict";

  const ENGINE_VERSION = [1, 26, 0];
  const SERVER_API_VERSION = "2.5.0";

  const CATEGORY_LABELS = {
    items: "アイテム",
    equipment: "装備",
    nature: "自然",
    construction: "建築",
  };

  function itemTextureKey(state) {
    return `${state.namespace}:${state.identifier}`;
  }

  function itemFileStem(state) {
    return `n${state.namespace.length}_${state.namespace}_i${state.identifier.length}_${state.identifier}`;
  }

  function componentId(state) {
    return `${state.namespace}:actions_${state.identifier}`;
  }

  function packFolderName(name) {
    const cleaned = String(name || "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim();
    return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "アイテムパック";
  }

  function cleanCommand(command) {
    return String(command || "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\/+/, ""))
      .filter(Boolean);
  }

  function commandMap(state) {
    return Object.fromEntries(
      Object.entries(state.actions).map(([name, action]) => [
        name,
        action.enabled ? cleanCommand(action.command) : [],
      ]),
    );
  }

  function buildItemDefinition(state) {
    const components = {
      "minecraft:display_name": { value: state.displayName },
      "minecraft:icon": { texture: itemTextureKey(state) },
      "minecraft:max_stack_size": state.type === "weapon" ? 1 : state.stackSize,
    };

    if (state.type === "food") {
      components["minecraft:food"] = {
        nutrition: state.nutrition,
        saturation_modifier: 0.6,
        can_always_eat: state.alwaysEat,
      };
      components["minecraft:use_modifiers"] = {
        use_duration: 1.6,
        movement_modifier: 0.35,
      };
      components["minecraft:use_animation"] = "eat";
    }

    if (state.type === "weapon") {
      components["minecraft:hand_equipped"] = true;
      components["minecraft:damage"] = state.damage;
      components["minecraft:durability"] = {
        max_durability: state.durability,
      };
    }

    if (state.actions.use.enabled && cleanCommand(state.actions.use.command).length) {
      components[componentId(state)] = {
        use: cleanCommand(state.actions.use.command).join("\n"),
      };
    }

    return {
      format_version: "1.26.0",
      "minecraft:item": {
        description: {
          identifier: `${state.namespace}:${state.identifier}`,
          menu_category: { category: state.category },
        },
        components,
      },
    };
  }

  function buildScript(itemStates) {
    const states = Array.isArray(itemStates) ? itemStates : [itemStates];
    const actionEntries = states.map((state) => {
      const commands = commandMap(state);
      return [
        `${state.namespace}:${state.identifier}`,
        { attack: commands.attack, sneak: commands.sneak, jump: commands.jump },
      ];
    });
    const useStates = states.filter((state) => commandMap(state).use.length > 0);
    const hasAttack = actionEntries.some(([, actions]) => actions.attack.length > 0);
    const hasButtonActions = actionEntries.some(([, actions]) => actions.sneak.length || actions.jump.length);
    const lines = [
      'import { ButtonState, EquipmentSlot, InputButton, system, world } from "@minecraft/server";',
      "",
      `const ITEM_ACTIONS = new Map(${JSON.stringify(actionEntries, null, 2)});`,
      "",
      "function runCommands(player, commands) {",
      "  if (!player || !commands?.length) return;",
      "",
      "  for (const command of commands) {",
      "    try {",
      "      player.runCommand(command);",
      "    } catch (error) {",
      '      console.warn(`[アイテム工房] コマンドを実行できませんでした: ${command} (${error})`);',
      "    }",
      "  }",
      "}",
    ];

    if (useStates.length) {
      lines.push(
        "",
        "system.beforeEvents.startup.subscribe((event) => {",
        ...useStates.flatMap((state) => [
          `  event.itemComponentRegistry.registerCustomComponent(${JSON.stringify(componentId(state))}, {`,
          "    onUse(useEvent, component) {",
          "      runCommands(useEvent.source, component?.params?.use?.split(/\\r?\\n/).filter(Boolean));",
          "    },",
          "  });",
        ]),
        "});",
      );
    }

    if (hasAttack) {
      lines.push(
        "",
        "world.afterEvents.playerSwingStart.subscribe((event) => {",
        "  const actions = ITEM_ACTIONS.get(event.heldItemStack?.typeId);",
        "  if (!actions) return;",
        "  runCommands(event.player, actions.attack);",
        "});",
      );
    }

    if (hasButtonActions) {
      const watchedButtons = [];
      if (actionEntries.some(([, actions]) => actions.sneak.length)) watchedButtons.push("InputButton.Sneak");
      if (actionEntries.some(([, actions]) => actions.jump.length)) watchedButtons.push("InputButton.Jump");

      lines.push(
        "",
        "world.afterEvents.playerButtonInput.subscribe((event) => {",
        "  if (event.newButtonState !== ButtonState.Pressed) return;",
        "  const heldItem = event.player.getComponent(\"minecraft:equippable\")?.getEquipment(EquipmentSlot.Mainhand);",
        "  const actions = ITEM_ACTIONS.get(heldItem?.typeId);",
        "  if (!actions) return;",
      );

      if (actionEntries.some(([, actions]) => actions.sneak.length)) {
        lines.push("  if (event.button === InputButton.Sneak) runCommands(event.player, actions.sneak);");
      }
      if (actionEntries.some(([, actions]) => actions.jump.length)) {
        lines.push("  if (event.button === InputButton.Jump) runCommands(event.player, actions.jump);");
      }

      lines.push(
        "}, {",
        `  buttons: [${watchedButtons.join(", ")}],`,
        "  state: ButtonState.Pressed,",
        "});",
      );
    }

    if (!hasAttack && !hasButtonActions && !useStates.length) {
      lines.push("", "// スイッチをオンにしたアクションがここに追加されます。");
    }

    return lines.join("\n");
  }

  function createUuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function jsonFile(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function buildAddonFiles(itemStates) {
    const states = Array.isArray(itemStates) ? itemStates : [itemStates];
    if (!states.length) throw new Error("アイテムを1つ以上追加してください。");

    const safePackName = packFolderName(states[0].addonName);
    if (states.some((state) => !state.iconBlob)) {
      throw new Error("アイテムのアイコンを作れませんでした。");
    }
    const resourcePackUuid = createUuid();
    const behaviorPackUuid = createUuid();
    const scriptModuleUuid = createUuid();

    const resourceManifest = {
      format_version: 2,
      header: {
        name: `${safePackName} - リソース`,
        description: `${states.length}個のアイテムのアイコン`,
        uuid: resourcePackUuid,
        version: [1, 0, 0],
        min_engine_version: ENGINE_VERSION,
      },
      modules: [
        {
          type: "resources",
          uuid: createUuid(),
          version: [1, 0, 0],
        },
      ],
    };

    const behaviorManifest = {
      format_version: 2,
      header: {
        name: `${safePackName} - ビヘイビア`,
        description: `${states.length}個のカスタムアイテムとアクション`,
        uuid: behaviorPackUuid,
        version: [1, 0, 0],
        min_engine_version: ENGINE_VERSION,
      },
      modules: [
        {
          type: "data",
          uuid: createUuid(),
          version: [1, 0, 0],
        },
        {
          type: "script",
          language: "javascript",
          uuid: scriptModuleUuid,
          version: [1, 0, 0],
          entry: "scripts/main.js",
        },
      ],
      dependencies: [
        { uuid: resourcePackUuid, version: [1, 0, 0] },
        { module_name: "@minecraft/server", version: SERVER_API_VERSION },
      ],
    };

    const textureIndex = {
      resource_pack_name: safePackName,
      texture_name: "atlas.items",
      texture_data: Object.fromEntries(states.map((state) => {
        const key = itemTextureKey(state);
        return [key, { textures: `textures/items/${itemFileStem(state)}` }];
      })),
    };

    const base = safePackName;
    const resourceRoot = `${base} Resource Pack`;
    const behaviorRoot = `${base} Behavior Pack`;
    const files = [
      { path: `${resourceRoot}/manifest.json`, data: jsonFile(resourceManifest) },
      { path: `${resourceRoot}/textures/item_texture.json`, data: jsonFile(textureIndex) },
      { path: `${behaviorRoot}/manifest.json`, data: jsonFile(behaviorManifest) },
      ...states.map((state) => ({
        path: `${behaviorRoot}/items/${itemFileStem(state)}.json`,
        data: jsonFile(buildItemDefinition(state)),
      })),
      { path: `${behaviorRoot}/scripts/main.js`, data: buildScript(states) },
      { path: `${base} - 説明.txt`, data: buildReadme(states, safePackName) },
    ];

    states.forEach((state, index) => {
      if (state.iconBlob) {
        const textureKey = itemTextureKey(state);
        files.push({ path: `${resourceRoot}/textures/items/${itemFileStem(state)}.png`, data: state.iconBlob });
        if (index === 0) {
          files.push({ path: `${resourceRoot}/pack_icon.png`, data: state.iconBlob });
          files.push({ path: `${behaviorRoot}/pack_icon.png`, data: state.iconBlob });
        }
      }
    });

    return files;
  }

  function buildReadme(states, packName) {
    const itemList = states.flatMap((state, index) => {
      const enabledActions = Object.entries(state.actions)
        .filter(([, action]) => action.enabled)
        .map(([name]) => ({ use: "右クリック・使う", attack: "左クリック", sneak: "スニーク", jump: "ジャンプ" })[name]);
      return [
        `${index + 1}. ${state.displayName}（${state.namespace}:${state.identifier}）`,
        `   ${state.type === "simple" ? "ふつう" : state.type === "food" ? "食べもの" : "近接武器"} / 分類: ${CATEGORY_LABELS[state.category]}`,
        `   動き: ${enabledActions.length ? enabledActions.join("、") : "なし"}`,
        `   入手: /give @s ${state.namespace}:${state.identifier}`,
      ];
    });
    return [
      packName,
      "=".repeat(Math.max(4, packName.length)),
      "",
      `作成アイテム: ${states.length}個`,
      "",
      ...itemList,
      "",
      "使い方",
      "1. この .mcaddon を開いて、Minecraft にインポートします。",
      "2. ワールドの設定でビヘイビアパックとリソースパックを有効にします。",
      "3. コマンドを使う場合は、ワールドでチートと必要な権限を有効にします。",
      "",
      "このパックは Minecraft 統合版 26.0 以降を対象にしています。",
      "",
    ].join("\n");
  }

  window.BedrockItemGenerator = Object.freeze({
    buildItemDefinition,
    buildScript,
    buildAddonFiles,
    getItemTextureKey: itemTextureKey,
  });
})();
