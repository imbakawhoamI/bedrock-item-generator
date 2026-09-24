(() => {
  "use strict";

  const ACTION_NAMES = ["use", "attack", "sneak", "jump"];
  const ACTION_LABELS = {
    use: "右クリック・使う",
    attack: "左クリック",
    sneak: "スニーク",
    jump: "ジャンプ",
  };
  const TYPE_LABELS = { simple: "ふつう", food: "食べもの", weapon: "近接武器" };
  const CATEGORY_LABELS = {
    items: "アイテム",
    equipment: "装備",
    nature: "自然",
    construction: "建築",
  };
  const ICON_COLORS = {
    pear: { dark: "#bd952e", middle: "#efc94f", light: "#fff0a5", accent: "#f6a252" },
    cyan: { dark: "#27899a", middle: "#59c8d4", light: "#b8f1ed", accent: "#f6a252" },
    coral: { dark: "#bd584e", middle: "#ef8870", light: "#ffc8a7", accent: "#f6d64d" },
    mint: { dark: "#418567", middle: "#72c49b", light: "#c1efd0", accent: "#f1c950" },
    lavender: { dark: "#77649e", middle: "#aa91d5", light: "#e4d5ff", accent: "#ef9b75" },
  };

  const form = document.getElementById("builder-form");
  const canvas = document.getElementById("item-icon");
  const context = canvas.getContext("2d");
  const imageInput = document.getElementById("item-image");
  const uploadZone = document.querySelector(".upload-zone");
  const clearImageButton = document.getElementById("clear-image");
  const status = document.getElementById("build-status");
  const buildButton = document.getElementById("build-button");
  const itemList = document.getElementById("item-list");
  const itemListCount = document.getElementById("item-list-count");
  const imageState = { image: null, objectUrl: null, loadToken: 0, isLoading: false };

  form.querySelectorAll('input[type="text"], input[type="number"], select, textarea')
    .forEach((control) => control.classList.add("form-95"));

  let items = [createItem(1, true)];
  let activeItemIndex = 0;
  let nextItemNumber = 2;
  let lastStackSize = 64;
  let previousType = "simple";

  function createItem(number, firstItem = false) {
    return {
      addonName: "ぼくのアイテムパック",
      displayName: firstItem ? "ひかりのつえ" : `アイテム ${number}`,
      namespace: "my_items",
      identifier: firstItem ? "light_staff" : `new_item_${number}`,
      category: "items",
      stackSize: 64,
      nonWeaponStackSize: 64,
      type: "simple",
      nutrition: 4,
      alwaysEat: false,
      damage: 6,
      durability: 180,
      iconColor: "pear",
      iconDataUrl: null,
      iconIsUploaded: false,
      iconFileName: "",
      actions: Object.fromEntries(ACTION_NAMES.map((name) => [name, { enabled: false, command: "" }])),
    };
  }

  function getValue(id) {
    return document.getElementById(id).value.trim();
  }

  function boundedNumber(id, fallback, min, max) {
    const value = Number.parseInt(document.getElementById(id).value, 10);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  function selectedRadio(name) {
    return form.querySelector(`input[name="${name}"]:checked`)?.value;
  }

  function getState() {
    const type = selectedRadio("item-type") || "simple";
    const visibleStackSize = boundedNumber("stack-size", 64, 1, 64);
    const actions = Object.fromEntries(
      ACTION_NAMES.map((name) => [name, {
        enabled: document.getElementById(`enable-${name}`).checked,
        command: document.getElementById(`command-${name}`).value,
      }]),
    );

    return {
      addonName: getValue("addon-name") || "ぼくのアイテムパック",
      displayName: getValue("display-name"),
      namespace: getValue("namespace").toLowerCase(),
      identifier: getValue("item-id").toLowerCase(),
      category: getValue("category"),
      stackSize: type === "weapon" ? 1 : visibleStackSize,
      nonWeaponStackSize: type === "weapon" ? lastStackSize : visibleStackSize,
      type,
      nutrition: boundedNumber("nutrition", 4, 1, 20),
      alwaysEat: document.getElementById("always-eat").checked,
      damage: boundedNumber("weapon-damage", 6, 1, 30),
      durability: boundedNumber("weapon-durability", 180, 1, 5000),
      iconColor: selectedRadio("icon-color") || "pear",
      iconDataUrl: null,
      iconIsUploaded: Boolean(imageState.image),
      iconFileName: items[activeItemIndex]?.iconFileName || "",
      actions,
    };
  }

  function isValidIdentifier(value, maxLength) {
    return value.length <= maxLength && /^[a-z0-9_]+$/.test(value);
  }

  function validateItem(state) {
    const problems = [];
    if (!state.displayName) problems.push("アイテムの名前を入力してね。");
    if (!isValidIdentifier(state.namespace, 32)) problems.push("IDの名前空間は英小文字・数字・_ で入力してね。");
    else if (state.namespace === "minecraft") problems.push("minecraftは予約IDだよ。別の名前空間にしてね。");
    if (!isValidIdentifier(state.identifier, 48)) problems.push("IDの名前は英小文字・数字・_ で入力してね。");

    for (const name of ACTION_NAMES) {
      if (state.actions[name].enabled && !state.actions[name].command.trim()) {
        problems.push(`${ACTION_LABELS[name]}のコマンドを書いてね。`);
      }
    }
    return problems;
  }

  function checkValidity(state) {
    const problems = validateItem(state);
    const namespaceInput = document.getElementById("namespace");
    const identifierInput = document.getElementById("item-id");
    const displayInput = document.getElementById("display-name");
    const currentCommandFields = ACTION_NAMES.map((name) => document.getElementById(`command-${name}`));

    for (const field of [namespaceInput, identifierInput, displayInput, ...currentCommandFields]) {
      field.removeAttribute("aria-invalid");
    }
    if (!state.displayName) displayInput.setAttribute("aria-invalid", "true");
    if (!isValidIdentifier(state.namespace, 32) || state.namespace === "minecraft") namespaceInput.setAttribute("aria-invalid", "true");
    if (!isValidIdentifier(state.identifier, 48)) identifierInput.setAttribute("aria-invalid", "true");
    for (const name of ACTION_NAMES) {
      if (state.actions[name].enabled && !state.actions[name].command.trim()) {
        document.getElementById(`command-${name}`).setAttribute("aria-invalid", "true");
      }
    }

    const seenIds = new Map();
    items.forEach((item, index) => {
      const id = `${item.namespace}:${item.identifier}`;
      if (!isValidIdentifier(item.namespace, 32) || item.namespace === "minecraft" || !isValidIdentifier(item.identifier, 48)) return;
      if (seenIds.has(id)) {
        if (seenIds.get(id) === activeItemIndex || index === activeItemIndex) {
          namespaceInput.setAttribute("aria-invalid", "true");
          identifierInput.setAttribute("aria-invalid", "true");
        }
        problems.push(`アイテムID「${id}」が重なっているよ。IDを変えてね。`);
      } else {
        seenIds.set(id, index);
      }
    });

    items.forEach((item, index) => {
      if (index === activeItemIndex) return;
      const otherProblems = validateItem(item);
      if (otherProblems.length) {
        const label = item.displayName || `アイテム ${index + 1}`;
        problems.push(`${label}: ${otherProblems[0]}`);
      }
    });
    return problems;
  }

  function drawGeneratedIcon() {
    const colors = ICON_COLORS[selectedRadio("icon-color")] || ICON_COLORS.pear;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;

    // 64px canvas with pixel-aligned shapes stays crisp in Minecraft's item atlas.
    context.fillStyle = "rgba(35, 57, 47, 0.13)";
    context.fillRect(14, 52, 38, 5);
    context.fillStyle = colors.dark;
    context.fillRect(26, 6, 12, 8);
    context.fillRect(22, 14, 20, 5);
    context.fillRect(17, 19, 30, 5);
    context.fillRect(13, 23, 38, 25);
    context.fillRect(17, 48, 30, 5);
    context.fillRect(21, 53, 22, 3);
    context.fillStyle = colors.middle;
    context.fillRect(17, 23, 30, 24);
    context.fillRect(21, 19, 22, 4);
    context.fillStyle = colors.light;
    context.fillRect(21, 26, 5, 17);
    context.fillRect(29, 23, 4, 4);
    context.fillStyle = colors.accent;
    context.fillRect(34, 32, 5, 5);
    context.fillRect(26, 39, 4, 4);
    context.fillStyle = "#fff9df";
    context.fillRect(20, 27, 2, 8);
  }

  function drawUploadedImage(image) {
    const padding = 5;
    const scale = Math.min(
      (canvas.width - padding * 2) / image.width,
      (canvas.height - padding * 2) / image.height,
    );
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const x = Math.floor((canvas.width - width) / 2);
    const y = Math.floor((canvas.height - height) / 2);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, x, y, width, height);
  }

  function drawIcon() {
    if (imageState.image) drawUploadedImage(imageState.image);
    else drawGeneratedIcon();
  }

  function updateConditionalFields(type) {
    document.getElementById("food-options").hidden = type !== "food";
    document.getElementById("weapon-options").hidden = type !== "weapon";
    const stackInput = document.getElementById("stack-size");
    stackInput.disabled = type === "weapon";

    if (type === "weapon" && previousType !== "weapon") {
      lastStackSize = boundedNumber("stack-size", 64, 1, 64);
      items[activeItemIndex].nonWeaponStackSize = lastStackSize;
      stackInput.value = "1";
    } else if (type !== "weapon" && previousType === "weapon") {
      stackInput.value = String(items[activeItemIndex].nonWeaponStackSize || lastStackSize);
    }
    previousType = type;
  }

  function updateActionFields() {
    for (const name of ACTION_NAMES) {
      const toggle = document.getElementById(`enable-${name}`);
      const area = document.getElementById(`command-area-${name}`);
      const card = document.querySelector(`[data-action-card="${name}"]`);
      area.hidden = !toggle.checked;
      card?.classList.toggle("is-enabled", toggle.checked);
    }
  }

  function updatePreviewActions(state) {
    const list = document.getElementById("preview-actions");
    list.replaceChildren();
    const active = ACTION_NAMES.filter((name) => state.actions[name].enabled);
    document.getElementById("action-count").textContent = `${active.length} / 4`;

    if (!active.length) {
      const empty = document.createElement("li");
      empty.className = "empty-actions";
      empty.textContent = "まだ動きはないよ。左のスイッチで追加しよう。";
      list.append(empty);
      return;
    }

    for (const name of active) {
      const item = document.createElement("li");
      const mark = document.createElement("span");
      mark.className = `preview-action-mark preview-action-${name}`;
      mark.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = ACTION_LABELS[name];
      item.append(mark, label);
      list.append(item);
    }
  }

  function updateUploadControls() {
    const storedItem = items[activeItemIndex];
    const hasUploadedImage = Boolean(imageState.image) || Boolean(imageState.isLoading && storedItem?.iconIsUploaded);
    const title = document.getElementById("upload-title");
    const description = document.getElementById("upload-description");
    const action = document.getElementById("upload-action");

    title.textContent = hasUploadedImage ? "画像を変更" : "画像を読みこむ";
    action.textContent = hasUploadedImage ? "えらびなおす" : "えらぶ";
    description.textContent = hasUploadedImage
      ? `${storedItem?.iconFileName || "画像を設定済み"} · このアイテムに設定中`
      : "PNG・JPG・WebP / 5MBまで · アイテムごとに設定";
    clearImageButton.hidden = !hasUploadedImage;
  }

  function updateCodePreviews(state) {
    document.getElementById("item-json-preview").textContent = JSON.stringify(
      BedrockItemGenerator.buildItemDefinition(state),
      null,
      2,
    );
    document.getElementById("script-preview").textContent = BedrockItemGenerator.buildScript(items);
  }

  function renderItemList() {
    itemList.replaceChildren();
    itemListCount.textContent = `${items.length}こ`;

    items.forEach((item, index) => {
      const select = document.createElement("button");
      select.type = "button";
      select.className = `item-entry btn${index === activeItemIndex ? " is-active" : ""}`;
      select.dataset.selectItem = String(index);
      select.setAttribute("role", "listitem");
      select.setAttribute("aria-current", index === activeItemIndex ? "true" : "false");

      const number = document.createElement("span");
      number.className = "item-entry-number";
      number.textContent = String(index + 1);
      const copy = document.createElement("span");
      copy.className = "item-entry-copy";
      const title = document.createElement("strong");
      title.textContent = item.displayName || "名前未入力";
      const id = document.createElement("small");
      id.textContent = `${item.namespace || "namespace"}:${item.identifier || "item"}`;
      copy.append(title, id);
      select.append(number, copy);
      itemList.append(select);
    });
  }

  function saveActiveItem() {
    const state = getState();
    const storedItem = items[activeItemIndex];
    if (imageState.isLoading && storedItem?.iconIsUploaded && storedItem.iconDataUrl) {
      state.iconIsUploaded = true;
      state.iconDataUrl = storedItem.iconDataUrl;
    } else {
      state.iconIsUploaded = Boolean(imageState.image);
      state.iconDataUrl = canvas.toDataURL("image/png");
    }
    items[activeItemIndex] = state;
    return state;
  }

  function updateStatus(problems) {
    const hasProblems = problems.length > 0;
    buildButton.disabled = hasProblems;
    status.textContent = hasProblems ? problems[0] : `全${items.length}アイテムをパックにできるよ`;
    status.classList.toggle("is-error", hasProblems);
    status.classList.remove("is-success");
  }

  function refreshPreview() {
    const type = selectedRadio("item-type") || "simple";
    updateConditionalFields(type);
    updateActionFields();

    const state = getState();
    document.getElementById("preview-name").textContent = state.displayName || "アイテムの名前";
    document.getElementById("preview-id").textContent = `${state.namespace || "namespace"}:${state.identifier || "item"}`;
    document.getElementById("preview-type").textContent = TYPE_LABELS[state.type];
    document.getElementById("preview-stack").textContent = `${state.stackSize}こ`;
    document.getElementById("preview-category").textContent = CATEGORY_LABELS[state.category] || CATEGORY_LABELS.items;
    updatePreviewActions(state);
    drawIcon();

    const storedItem = items[activeItemIndex];
    if (imageState.isLoading && storedItem?.iconIsUploaded && storedItem.iconDataUrl) {
      state.iconIsUploaded = true;
      state.iconDataUrl = storedItem.iconDataUrl;
    } else {
      state.iconIsUploaded = Boolean(imageState.image);
      state.iconDataUrl = canvas.toDataURL("image/png");
    }
    items[activeItemIndex] = state;
    updateUploadControls();
    renderItemList();
    updateCodePreviews(state);
    updateStatus(checkValidity(state));
  }

  function announceIconChange() {
    const frame = document.getElementById("item-icon-frame");
    frame.classList.remove("is-refreshing");
    void frame.offsetWidth;
    frame.classList.add("is-refreshing");
  }

  function releaseCurrentImage() {
    if (imageState.objectUrl) URL.revokeObjectURL(imageState.objectUrl);
    imageState.objectUrl = null;
    imageState.image = null;
    imageState.isLoading = false;
    imageState.loadToken += 1;
  }

  function loadItem(index) {
    saveActiveItem();
    activeItemIndex = index;
    const item = items[index];
    releaseCurrentImage();
    imageInput.value = "";

    document.getElementById("display-name").value = item.displayName;
    document.getElementById("namespace").value = item.namespace;
    document.getElementById("item-id").value = item.identifier;
    document.getElementById("category").value = item.category;
    document.getElementById("stack-size").value = String(item.type === "weapon" ? 1 : item.stackSize);
    document.getElementById("nutrition").value = String(item.nutrition);
    document.getElementById("always-eat").checked = item.alwaysEat;
    document.getElementById("weapon-damage").value = String(item.damage);
    document.getElementById("weapon-durability").value = String(item.durability);
    form.querySelector(`input[name="item-type"][value="${item.type}"]`).checked = true;
    form.querySelector(`input[name="icon-color"][value="${item.iconColor}"]`).checked = true;

    for (const name of ACTION_NAMES) {
      document.getElementById(`enable-${name}`).checked = item.actions[name].enabled;
      document.getElementById(`command-${name}`).value = item.actions[name].command;
    }

    lastStackSize = item.nonWeaponStackSize || item.stackSize || 64;
    previousType = item.type;
    clearImageButton.hidden = !item.iconIsUploaded;

    if (item.iconIsUploaded && item.iconDataUrl) {
      imageState.isLoading = true;
      const token = imageState.loadToken;
      const image = new Image();
      image.onload = () => {
        if (activeItemIndex !== index || imageState.loadToken !== token) return;
        imageState.isLoading = false;
        imageState.image = image;
        refreshPreview();
      };
      image.onerror = () => {
        if (activeItemIndex !== index || imageState.loadToken !== token) return;
        imageState.isLoading = false;
        items[index].iconFileName = "";
        refreshPreview();
      };
      image.src = item.iconDataUrl;
    }

    refreshPreview();
  }

  function addItem() {
    let number = nextItemNumber;
    let newItem = createItem(number);
    while (items.some((item) => item.namespace === newItem.namespace && item.identifier === newItem.identifier)) {
      number += 1;
      newItem = createItem(number);
    }
    nextItemNumber = number + 1;
    items.push(newItem);
    loadItem(items.length - 1);
  }

  function activateItem(index) {
    if (!Number.isInteger(index) || index === activeItemIndex || index < 0 || index >= items.length) return;
    loadItem(index);
  }

  async function readImage(file) {
    if (!file) return;
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setStatusMessage("PNG・JPG・WebPの画像を選んでね。", true);
      imageInput.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage("画像は5MBまでだよ。", true);
      imageInput.value = "";
      return;
    }

    releaseCurrentImage();
    const token = imageState.loadToken;
    imageState.isLoading = true;
    imageState.objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (imageState.loadToken !== token) return;
      imageState.isLoading = false;
      imageState.image = image;
      items[activeItemIndex].iconFileName = file.name;
      refreshPreview();
      announceIconChange();
    };
    image.onerror = () => {
      if (imageState.loadToken !== token) return;
      releaseCurrentImage();
      items[activeItemIndex].iconFileName = "";
      refreshPreview();
      setStatusMessage("この画像は読みこめなかったよ。別の画像を選んでね。", true);
    };
    image.src = imageState.objectUrl;
  }

  function setStatusMessage(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("is-error", isError);
    status.classList.toggle("is-success", !isError);
  }

  async function copyGiveCommand() {
    const state = getState();
    const command = `/give @s ${state.namespace}:${state.identifier}`;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const temporary = document.createElement("textarea");
      temporary.value = command;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
    }
    const button = document.getElementById("copy-give-command");
    const originalLabel = button.querySelector("span").textContent;
    button.querySelector("span").textContent = "コピーしたよ";
    window.setTimeout(() => { button.querySelector("span").textContent = originalLabel; }, 1500);
  }

  function dataUrlToBlob(dataUrl) {
    const [metadata, base64] = dataUrl.split(",");
    const mimeType = metadata.match(/^data:(.*?);base64$/)?.[1] || "image/png";
    const decoded = atob(base64);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }

  async function createAddon() {
    const currentState = saveActiveItem();
    const problems = checkValidity(currentState);
    if (problems.length) {
      updateStatus(problems);
      return;
    }

    buildButton.disabled = true;
    buildButton.classList.add("is-loading");
    status.classList.remove("is-error", "is-success");
    status.textContent = `${items.length}アイテムをパックにまとめているよ…`;

    try {
      const packName = getValue("addon-name") || "ぼくのアイテムパック";
      const exportItems = items.map((item) => ({
        ...item,
        addonName: packName,
        iconBlob: dataUrlToBlob(item.iconDataUrl),
      }));
      const files = BedrockItemGenerator.buildAddonFiles(exportItems);
      const fileBaseName = packName
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim() || "アイテムパック";
      const filename = `${fileBaseName}.mcaddon`;
      await BedrockZip.download(files, filename);
      setStatusMessage("できたよ！ ダウンロードしたパックを開いてMinecraftに入れよう。", false);
      buildButton.classList.add("is-success");
    } catch (error) {
      console.error(error);
      setStatusMessage("パックを作れなかったよ。もう一度ためしてね。", true);
      buildButton.classList.add("is-error");
    } finally {
      buildButton.classList.remove("is-loading");
      buildButton.disabled = checkValidity(getState()).length > 0;
      window.setTimeout(() => buildButton.classList.remove("is-success", "is-error"), 1800);
    }
  }

  form.addEventListener("input", refreshPreview);
  form.addEventListener("change", (event) => {
    if (event.target.matches("input[name='icon-color']")) announceIconChange();
    refreshPreview();
  });
  itemList.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-select-item]");
    if (selectButton) activateItem(Number(selectButton.dataset.selectItem));
  });
  document.getElementById("add-item").addEventListener("click", addItem);
  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    readImage(file);
    imageInput.value = "";
  });
  uploadZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("is-dragging");
  });
  uploadZone.addEventListener("dragleave", (event) => {
    if (!uploadZone.contains(event.relatedTarget)) uploadZone.classList.remove("is-dragging");
  });
  uploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("is-dragging");
    readImage(event.dataTransfer.files?.[0]);
  });
  clearImageButton.addEventListener("click", () => {
    releaseCurrentImage();
    items[activeItemIndex].iconFileName = "";
    imageInput.value = "";
    refreshPreview();
    announceIconChange();
  });
  document.getElementById("copy-give-command").addEventListener("click", copyGiveCommand);
  buildButton.addEventListener("click", createAddon);

  refreshPreview();
})();
