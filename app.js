const input = document.querySelector("#prefixInput");
const ghost = document.querySelector("#ghostText");
const suggestions = document.querySelector("#prefixSuggestions");
const message = document.querySelector("#message");
const prefixList = document.querySelector("#prefixList");
const prefixMeta = document.querySelector("#prefixMeta");
const currentDetails = document.querySelector("#currentDetails");
const adjacentDetails = document.querySelector("#adjacentDetails");
const containsInput = document.querySelector("#containsInput");
const containsResult = document.querySelector("#containsResult");
const themeToggle = document.querySelector("#themeToggle");
const presentationControl = document.querySelector("#presentationControl");
const presentationOptions = Array.from(document.querySelectorAll("[data-presentation]"));
const navButtons = Array.from(document.querySelectorAll("[data-nav]"));
const panels = Array.from(document.querySelectorAll(".panel"));

const VERSION_BITS = { 4: 32, 6: 128 };
const MAX_VALUES = { 4: 1n << 32n, 6: 1n << 128n };
const URL_PREFIX_PARAM = "prefix";
const URL_VIEW_PARAM = "view";
const PREFIX_HISTORY_LIMIT = 100;
const MOUSE_BACK_BUTTON = 3;
const MOUSE_FORWARD_BUTTON = 4;
const DEFAULT_SUGGESTIONS = [
  "192.168.10.0/24",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "100.64.0.0/10",
  "127.0.0.1/32",
  "8.8.8.8/32",
  "::1/128",
  "2001:db8::/32",
  "fc00::/7",
  "fe80::/10",
  "::ffff:192.0.2.1/128",
];
const IPV6_COMPRESSION_LIGATURE = "∷";
const INPUT_WRAP_HINT = "\u200b";
const PRESENTATION_MODES = [
  { id: "regular", label: "Regular" },
  { id: "hex", label: "Hex" },
  { id: "binary", label: "Binary" },
  { id: "integer", label: "Integer" },
];

let current = null;
const loadedPresentationMode = loadPresentationModeFromUrl();
let shouldUseLoadedPresentationMode = Boolean(loadedPresentationMode);
let presentationMode = loadedPresentationMode || PRESENTATION_MODES[0].id;
let typingTimer = 0;
let recents = loadRecents();
let prefixHistory = [];
let prefixHistoryIndex = -1;
let previousPrefixKey = "";
let lastMouseHistoryButton = null;
let lastMouseHistoryButtonTime = 0;
const adjacencyMapResizeObserver = "ResizeObserver" in window
  ? new ResizeObserver(() => updateAdjacencyMap())
  : null;

function parsePrefix(value) {
  const raw = cleanPrefixInputValue(value).trim();
  if (!raw) {
    throw new Error("enter a prefix");
  }

  const slashCount = (raw.match(/\//g) || []).length;
  if (slashCount > 1) {
    throw new Error("too many slashes");
  }

  const [addressText, prefixText] = raw.split("/");
  const version = addressText.includes(":") ? 6 : 4;
  const bits = VERSION_BITS[version];
  const address = version === 4 ? parseIPv4(addressText) : parseIPv6(addressText);
  const prefixLength = prefixText === undefined || prefixText === ""
    ? bits
    : parsePrefixLength(prefixText, bits);
  const hostBits = BigInt(bits - prefixLength);
  const size = 1n << hostBits;
  const network = (address >> hostBits) << hostBits;
  const last = network + size - 1n;

  return {
    version,
    bits,
    address,
    prefixLength,
    hostBits,
    size,
    network,
    last,
  };
}

function parsePrefixLength(value, bits) {
  if (!/^\d+$/.test(value)) {
    throw new Error("bad prefix length");
  }

  const prefixLength = Number(value);
  if (prefixLength < 0 || prefixLength > bits) {
    throw new Error(`prefix length must be 0-${bits}`);
  }

  return prefixLength;
}

function parseIPv4(value) {
  const parts = value.trim().split(".");
  if (parts.length !== 4) {
    throw new Error("IPv4 needs four octets");
  }

  return parts.reduce((acc, part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error("bad IPv4 octet");
    }

    const octet = Number(part);
    if (octet > 255) {
      throw new Error("IPv4 octet must be 0-255");
    }

    return (acc << 8n) + BigInt(octet);
  }, 0n);
}

function parseIPv6(value) {
  const text = value.trim().toLowerCase();
  if (!text || text.includes("%")) {
    throw new Error("bad IPv6 address");
  }

  const compressed = text.includes("::");
  if ((text.match(/::/g) || []).length > 1) {
    throw new Error("bad IPv6 compression");
  }

  const [leftText = "", rightText = ""] = text.split("::");
  const leftParts = leftText ? leftText.split(":") : [];
  const rightParts = rightText ? rightText.split(":") : [];
  validateIPv4Tail(leftParts, rightParts);

  const left = parseIPv6Parts(leftParts);
  const right = parseIPv6Parts(rightParts);
  const used = left.length + right.length;
  const fill = compressed ? 8 - used : 0;

  if ((!compressed && used !== 8) || (compressed && fill < 1)) {
    throw new Error("bad IPv6 length");
  }

  const groups = [...left, ...Array(fill).fill(0), ...right];
  if (groups.length !== 8) {
    throw new Error("bad IPv6 address");
  }

  return groups.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

function validateIPv4Tail(leftParts, rightParts) {
  const all = [...leftParts, ...rightParts];
  const dotIndexes = all.flatMap((part, index) => (part.includes(".") ? [index] : []));
  if (dotIndexes.length > 1 || (dotIndexes.length === 1 && dotIndexes[0] !== all.length - 1)) {
    throw new Error("IPv4 tail must be last");
  }
}

function parseIPv6Parts(parts) {
  const groups = [];

  for (const part of parts) {
    if (!part) {
      throw new Error("bad IPv6 group");
    }

    if (part.includes(".")) {
      const ipv4 = parseIPv4(part);
      groups.push(Number((ipv4 >> 16n) & 0xffffn), Number(ipv4 & 0xffffn));
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      throw new Error("bad IPv6 group");
    }

    groups.push(parseInt(part, 16));
  }

  return groups;
}

function formatAddress(value, version) {
  return version === 4 ? formatIPv4(value) : formatIPv6(value);
}

function formatIPv4(value) {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 255n))
    .join(".");
}

function formatIPv6(value) {
  const groups = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(Number((value >> shift) & 0xffffn));
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }

    let end = index;
    while (end < groups.length && groups[end] === 0) {
      end += 1;
    }

    const length = end - index;
    if (length > bestLength && length > 1) {
      bestStart = index;
      bestLength = length;
    }
    index = end;
  }

  if (bestStart === -1) {
    return groups.map((group) => group.toString(16)).join(":");
  }

  const before = groups.slice(0, bestStart).map((group) => group.toString(16)).join(":");
  const after = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(":");

  if (!before && !after) return "::";
  if (!before) return `::${after}`;
  if (!after) return `${before}::`;
  return `${before}::${after}`;
}

function formatPrefix(prefix) {
  return `${formatAddress(prefix.network, prefix.version)}/${prefix.prefixLength}`;
}

function formatInputPrefix(prefix) {
  return `${formatAddress(prefix.address, prefix.version)}/${prefix.prefixLength}`;
}

function formatInputPrefixLength(prefixLength) {
  const raw = cleanPrefixInputValue();
  const slashIndex = raw.indexOf("/");
  const addressText = slashIndex === -1 ? raw : raw.slice(0, slashIndex);
  return `${addressText}/${prefixLength}`;
}

function formatMask(prefix) {
  return formatAddress(maskValue(prefix), prefix.version);
}

function maskValue(prefix) {
  return ((1n << BigInt(prefix.prefixLength)) - 1n) << prefix.hostBits;
}

function formatPresentedPrefix(prefix) {
  return `${formatPresentedAddress(prefix.network, prefix.version)}/${prefix.prefixLength}`;
}

function formatPresentedAddress(value, version, mode = presentationMode) {
  if (mode === "hex") {
    return version === 4 ? formatIPv4Hex(value) : formatIPv6Hex(value);
  }

  if (mode === "binary") {
    return version === 4 ? formatIPv4Binary(value) : formatIPv6Binary(value);
  }

  if (mode === "integer") {
    return value.toString();
  }

  return formatAddress(value, version);
}

function formatPresentedCount(value) {
  if (presentationMode === "hex") {
    return `0x${value.toString(16)}`;
  }

  if (presentationMode === "binary") {
    return `0b${value.toString(2)}`;
  }

  return formatCount(value);
}

function formatPresentedAddressPosition(prefix) {
  const diff = prefix.address - prefix.network;
  const positionSize = `${formatPresentedCount(diff)} / ${formatPresentedCount(prefix.size)}`;
  if (prefix.prefixLength >= prefix.bits) {
    return positionSize;
  }

  const child = prefix.address < prefix.network + (prefix.size >> 1n) ? "↙" : "↘";
  return `${positionSize} ${child}`;
}

function formatIPv4Hex(value) {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 255n).toString(16).padStart(2, "0"))
    .join(".");
}

function formatIPv6Hex(value) {
  const groups = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(Number((value >> shift) & 0xffffn).toString(16).padStart(4, "0"));
  }
  return groups.join(":");
}

function formatIPv4Binary(value) {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 255n).toString(2).padStart(8, "0"))
    .join(".");
}

function formatIPv6Binary(value) {
  const groups = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(Number((value >> shift) & 0xffffn).toString(2).padStart(16, "0"));
  }
  return groups.join(":");
}

function formatDisplayText(value) {
  return value.replaceAll("::", IPV6_COMPRESSION_LIGATURE);
}

function normalizeDisplayText(value) {
  return value
    .replaceAll(INPUT_WRAP_HINT, "")
    .replace(new RegExp(`${IPV6_COMPRESSION_LIGATURE}[\r\n]*`, "g"), "::")
    .replace(/:[\r\n]+/g, ":")
    .replace(/\.[\r\n]+/g, ".");
}

function cleanPrefixInputValue(value = input.value) {
  return value.replaceAll(INPUT_WRAP_HINT, "");
}

function formatPrefixInputValue(value) {
  return cleanPrefixInputValue(value).replace(/([:.])/g, `$1${INPUT_WRAP_HINT}`);
}

function setPrefixInputValue(value) {
  input.value = formatPrefixInputValue(value);
}

function syncPrefixInputWrapHints() {
  const value = input.value;
  const cleanValue = cleanPrefixInputValue(value);
  const formattedValue = formatPrefixInputValue(cleanValue);

  if (value === formattedValue) {
    return cleanValue;
  }

  const selectionStart = cleanPrefixInputValue(value.slice(0, input.selectionStart ?? value.length)).length;
  const selectionEnd = cleanPrefixInputValue(value.slice(0, input.selectionEnd ?? value.length)).length;
  input.value = formattedValue;
  input.setSelectionRange(
    displayIndexForCleanIndex(formattedValue, selectionStart),
    displayIndexForCleanIndex(formattedValue, selectionEnd),
  );

  return cleanValue;
}

function displayIndexForCleanIndex(value, cleanIndex) {
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (seen === cleanIndex) {
      return index;
    }
    if (value[index] !== INPUT_WRAP_HINT) {
      seen += 1;
    }
  }
  return value.length;
}

function setDisplayText(element, value) {
  const displayText = formatDisplayText(value);
  const nodes = [];

  for (const character of displayText) {
    nodes.push(document.createTextNode(character));
    if (character === ":" || character === IPV6_COMPRESSION_LIGATURE) {
      nodes.push(document.createElement("wbr"));
    }
  }

  element.replaceChildren(...nodes);
  element.classList.toggle("display-text--wrap-separator", /[:∷]/.test(displayText));
  element.dataset.copyValue = value;
  if (value !== displayText) {
    element.setAttribute("aria-label", value);
  } else {
    element.removeAttribute("aria-label");
  }
}

function prefixFromNetwork(network, base = current) {
  const max = MAX_VALUES[base.version];
  const size = base.size;
  const clamped = clampBigInt(network, 0n, max - size);
  return {
    ...base,
    address: clamped,
    network: clamped,
    last: clamped + size - 1n,
  };
}

function prefixFromNetworkPreservingAddress(network, base = current) {
  const max = MAX_VALUES[base.version];
  const size = base.size;
  const clamped = clampBigInt(network, 0n, max - size);
  const addressOffset = base.address - base.network;
  const address = clampBigInt(clamped + addressOffset, clamped, clamped + size - 1n);

  return {
    ...base,
    address,
    network: clamped,
    last: clamped + size - 1n,
  };
}

function childPrefix(base, second = false) {
  if (base.prefixLength >= base.bits) return null;
  const size = base.size >> 1n;
  const network = base.network + (second ? size : 0n);
  return {
    ...base,
    prefixLength: base.prefixLength + 1,
    hostBits: base.hostBits - 1n,
    size,
    network,
    address: network,
    last: network + size - 1n,
  };
}

function parentPrefix(base) {
  if (base.prefixLength <= 0) return null;
  const prefixLength = base.prefixLength - 1;
  const hostBits = BigInt(base.bits - prefixLength);
  const size = 1n << hostBits;
  const network = (base.network >> hostBits) << hostBits;
  return {
    ...base,
    prefixLength,
    hostBits,
    size,
    network,
    address: network,
    last: network + size - 1n,
  };
}

function adjacentPrefix(base, direction) {
  const target = base.network + base.size * BigInt(direction);
  if (target < 0n || target + base.size > MAX_VALUES[base.version]) {
    return null;
  }
  return prefixFromNetwork(target, base);
}

function render() {
  let next = null;
  try {
    const previousVersion = current?.version;
    next = parsePrefix(input.value);
    if (previousVersion !== next.version) {
      if (shouldUseLoadedPresentationMode) {
        shouldUseLoadedPresentationMode = false;
      } else {
        setDefaultPresentation(next.version);
      }
    }
    current = next;
    message.textContent = "";
    input.setAttribute("aria-invalid", "false");
    savePrefixToUrl(next);
  } catch (error) {
    message.textContent = error.message;
    input.setAttribute("aria-invalid", "true");
    updateNavControls(null);
    updatePresentationControl(null);
    updateGhost();
    resizePrefixInput();
    checkContainment();
    return;
  }

  renderPrefixList(next);
  renderCurrent(next);
  renderAdjacent(next);
  updateNavControls(next);
  updatePresentationControl(next);
  checkContainment();
  updateSuggestions(next);
  updateGhost();
  resizePrefixInput();
  flashPanels();
}

function renderPrefixList(prefix) {
  const windowSize = 17;
  const middle = Math.floor(windowSize / 2);
  const maxIndex = MAX_VALUES[prefix.version] / prefix.size - 1n;
  const index = prefix.network / prefix.size;
  let start = index - BigInt(middle);

  if (start < 0n) start = 0n;
  if (start + BigInt(windowSize - 1) > maxIndex) {
    start = maxIndex - BigInt(windowSize - 1);
  }
  if (start < 0n) start = 0n;

  const rows = [];
  const rowCount = Number(minBigInt(BigInt(windowSize), maxIndex + 1n));
  for (let offset = 0; offset < rowCount; offset += 1) {
    const rowIndex = start + BigInt(offset);
    const network = rowIndex * prefix.size;
    const row = prefixFromNetwork(network, prefix);
    rows.push(row);
  }

  prefixMeta.textContent = `/${prefix.prefixLength}`;
  prefixList.replaceChildren(
    ...rows.map((row) => {
      const isCurrent = row.network === prefix.network;
      const isPrevious = !isCurrent && isPreviousPrefix(row);
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "prefix-item",
        isCurrent ? "active" : "",
        isPrevious ? "previous" : "",
      ].filter(Boolean).join(" ");
      button.dataset.prefix = formatPrefix(row);
      button.innerHTML = `<span></span><span></span>`;
      setDisplayText(button.children[0], formatPrefix(row));
      button.children[1].textContent = isCurrent
        ? "now"
        : isPrevious
          ? "(previous)"
          : signedOffset(row.network, prefix);
      button.addEventListener("click", () => setPrefixWithNavigatedAddress(row, prefix));
      return button;
    }),
  );
}

function signedOffset(rowNetwork, prefix) {
  const distance = (rowNetwork - prefix.network) / prefix.size;
  return distance > 0n ? `+${distance}` : `${distance}`;
}

function renderCurrent(prefix) {
  const details = [
    ["Prefix", formatPresentedPrefix(prefix)],
    ["Address position / size", formatPresentedAddressPosition(prefix)],
    ["Version", `IPv${prefix.version}`],
    ["Mask", formatPresentedAddress(maskValue(prefix), prefix.version)],
    ["Network", formatPresentedAddress(prefix.network, prefix.version)],
    [prefix.version === 4 ? "Broadcast" : "Last", formatPresentedAddress(prefix.last, prefix.version)],
  ];

  currentDetails.replaceChildren(...details.flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    setDisplayText(dd, value);
    return [dt, dd];
  }));
}

function renderAdjacent(prefix) {
  const items = [
    ["parent", "Parent", parentPrefix(prefix)],
    ["left", "Left", adjacentPrefix(prefix, -1)],
    ["right", "Right", adjacentPrefix(prefix, 1)],
    ["child-left", "Child 1", childPrefix(prefix, false)],
    ["child-right", "Child 2", childPrefix(prefix, true)],
  ].filter(([, , item]) => item);

  const map = createAdjacencyMap(items.map(([role]) => role));
  const buttons = items.map(([role, label, item]) => {
    const isPrevious = isPreviousPrefix(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "adjacent-button",
      `adjacent-button--${role}`,
      isPrevious ? "previous" : "",
    ].filter(Boolean).join(" ");
    button.innerHTML = `<span></span><b></b>`;
    button.children[0].textContent = isPrevious ? `${label} (previous)` : label;
    setDisplayText(button.children[1], formatPrefix(item));
    if (isPrevious) {
      button.title = `Previous prefix: ${formatPrefix(item)}`;
    }
    button.addEventListener("click", () => setAdjacentPrefix(item, prefix));
    return button;
  });

  adjacentDetails.replaceChildren(map, ...buttons);
  adjacencyMapResizeObserver?.disconnect();
  adjacencyMapResizeObserver?.observe(adjacentDetails);
  updateAdjacencyMap(map);
}

function createAdjacencyMap(roles) {
  const map = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const dot = document.createElement("button");

  map.className = "adjacency-map";
  map.dataset.roles = roles.join(" ");
  map.classList.toggle("has-previous", Boolean(previousPrefixKey));
  svg.classList.add("adjacency-lines");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("preserveAspectRatio", "none");
  dot.className = "adjacency-dot";
  dot.type = "button";
  dot.title = "Clear previous prefix";
  dot.setAttribute("aria-label", "Clear previous prefix");
  dot.addEventListener("click", clearPreviousPrefixHighlight);

  map.append(svg, dot);
  return map;
}

function updateAdjacencyMap(map = adjacentDetails.querySelector(".adjacency-map")) {
  if (!map) return;

  const svg = map.querySelector(".adjacency-lines");
  const dot = map.querySelector(".adjacency-dot");
  const mapRect = map.getBoundingClientRect();
  const roles = map.dataset.roles.split(" ").filter(Boolean);

  svg.replaceChildren();
  if (!mapRect.width || !mapRect.height) return;

  const centers = Object.fromEntries(roles.flatMap((role) => {
    const button = adjacentDetails.querySelector(`.adjacent-button--${role}`);
    if (!button) return [];

    const rect = button.getBoundingClientRect();
    return [[role, [
      rect.left + rect.width / 2 - mapRect.left,
      rect.top + rect.height / 2 - mapRect.top,
    ]]];
  }));
  const center = adjacencyCenter(centers, mapRect);

  dot.style.left = `${center[0]}px`;
  dot.style.top = `${center[1]}px`;
  svg.setAttribute("viewBox", `0 0 ${mapRect.width} ${mapRect.height}`);

  const childRoles = roles.filter((role) => role.startsWith("child-") && centers[role]);
  const childJunction = childRoles.length > 1
    ? [
        center[0],
        childRoles.reduce((sum, role) => sum + centers[role][1], 0) / childRoles.length,
      ]
    : null;
  const previousChildRole = childRoles.find((role) => {
    const button = adjacentDetails.querySelector(`.adjacent-button--${role}`);
    return button?.classList.contains("previous");
  });

  if (childJunction) {
    appendAdjacencyLine(svg, [center, childJunction], Boolean(previousChildRole));
  }

  roles.forEach((role) => {
    const point = centers[role];
    if (!point) return;

    const button = adjacentDetails.querySelector(`.adjacent-button--${role}`);
    const isPrevious = button?.classList.contains("previous");
    const routeToPrefix = childJunction && role.startsWith("child-")
      ? [childJunction, point]
      : role.startsWith("child-")
      ? [center, [center[0], point[1]], point]
      : [center, point];
    appendAdjacencyLine(svg, routeToPrefix, isPrevious);
  });
}

function appendAdjacencyLine(svg, routeToPrefix, isPrevious = false) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  const route = isPrevious ? [...routeToPrefix].reverse() : routeToPrefix;

  if (isPrevious) {
    line.classList.add("previous");
  }
  line.setAttribute("points", route.map(([x, y]) => `${x},${y}`).join(" "));
  svg.append(line);
}

function adjacencyCenter(centers, mapRect) {
  if (centers.left && centers.right) {
    return [
      (centers.left[0] + centers.right[0]) / 2,
      (centers.left[1] + centers.right[1]) / 2,
    ];
  }

  const rowAnchor = centers.left || centers.right || centers["child-left"] || centers["child-right"];
  return [
    mapRect.width / 2,
    rowAnchor ? rowAnchor[1] : mapRect.height / 2,
  ];
}

function setPrefix(prefix, remember = true) {
  beginPrefixNavigation();
  setPrefixInputValue(formatPrefix(prefix));
  current = prefix;
  if (remember) {
    rememberPrefix(cleanPrefixInputValue());
  }
  recordPrefixHistory(formatInputPrefix(prefix));
  render();
}

function setAdjacentPrefix(prefix, base) {
  setPrefixWithNavigatedAddress(prefix, base);
}

function setPrefixWithNavigatedAddress(prefix, base) {
  beginPrefixNavigation(base);
  setPrefixWithAddress(prefix, navigatedAddress(prefix, base));
}

function navigatedAddress(prefix, base) {
  if (containsAddress(prefix, base.address)) {
    return base.address;
  }

  const addressOffset = (base.address - base.network) % prefix.size;
  return prefix.network + addressOffset;
}

function movePrefix(delta) {
  if (!current) return;
  beginPrefixNavigation();
  const target = current.network + current.size * BigInt(delta);
  const next = prefixFromNetworkPreservingAddress(target, current);
  setPrefixWithAddress(next, next.address);
}

function resizePrefix(direction) {
  if (!current) return;
  beginPrefixNavigation();
  const next = direction < 0 ? childPrefixContaining(current) : parentPrefix(current);
  if (next) {
    setPrefixLengthWithAddress(next, current.address);
  }
}

function childPrefixContaining(base) {
  if (base.prefixLength >= base.bits) return null;
  const second = base.address >= base.network + (base.size >> 1n);
  return childPrefix(base, second);
}

function containsAddress(prefix, address) {
  return address >= prefix.network && address <= prefix.last;
}

function setPrefixWithAddress(prefix, address, remember = true) {
  const next = { ...prefix, address };
  setPrefixInputValue(formatInputPrefix(next));
  current = next;
  if (remember) {
    rememberPrefix(cleanPrefixInputValue());
  }
  recordPrefixHistory(formatInputPrefix(next));
  render();
}

function setPrefixLengthWithAddress(prefix, address, remember = true) {
  const next = { ...prefix, address };
  setPrefixInputValue(formatInputPrefixLength(next.prefixLength));
  current = next;
  if (remember) {
    rememberPrefix(cleanPrefixInputValue());
  }
  recordPrefixHistory(formatInputPrefix(next));
  render();
}

function updateNavControls(prefix) {
  const previousDirection = prefix ? previousNavDirection(prefix) : "";
  const controls = prefix
    ? {
        up: {
          enabled: Boolean(adjacentPrefix(prefix, -1)),
          label: `-${formatPowerOfTwoLabel(prefix.hostBits)}`,
          title: `Previous prefix (-${formatCount(prefix.size)})`,
        },
        down: {
          enabled: Boolean(adjacentPrefix(prefix, 1)),
          label: `+${formatPowerOfTwoLabel(prefix.hostBits)}`,
          title: `Next prefix (+${formatCount(prefix.size)})`,
        },
        left: {
          enabled: Boolean(parentPrefix(prefix)),
          label: `/${Math.max(0, prefix.prefixLength - 1)}`,
          title: "Parent prefix",
        },
        right: {
          enabled: Boolean(childPrefix(prefix, false)),
          label: `/${Math.min(prefix.bits, prefix.prefixLength + 1)}`,
          title: "Child prefix",
        },
      }
    : {
        up: { enabled: false, label: "-", title: "Previous prefix" },
        down: { enabled: false, label: "-", title: "Next prefix" },
        left: { enabled: false, label: "-", title: "Parent prefix" },
        right: { enabled: false, label: "-", title: "Child prefix" },
      };

  navButtons.forEach((button) => {
    const control = controls[button.dataset.nav];
    button.disabled = !control.enabled;
    button.textContent = control.label;
    button.classList.toggle("previous", button.dataset.nav === previousDirection);
    button.setAttribute("aria-label", control.title);
    button.title = control.title;
  });
}

function previousNavDirection(prefix) {
  const directions = [
    ["up", adjacentPrefix(prefix, -1)],
    ["down", adjacentPrefix(prefix, 1)],
    ["left", parentPrefix(prefix)],
    ["right", childPrefixContaining(prefix)],
  ];
  return directions.find(([, item]) => item && isPreviousPrefix(item))?.[0] || "";
}

function setDefaultPresentation() {
  setPresentationMode(PRESENTATION_MODES[0].id, false);
}

function setPresentationMode(mode, renderPanel = true) {
  presentationMode = normalizePresentationMode(mode);
  savePresentationModeToUrl();
  updatePresentationControl(current);
  if (renderPanel && current) {
    renderCurrent(current);
  }
}

function updatePresentationControl(prefix) {
  const modeIndex = Math.max(0, PRESENTATION_MODES.findIndex((item) => item.id === presentationMode));
  presentationControl.style.setProperty("--presentation-index", modeIndex);
  presentationControl.classList.toggle("is-disabled", !prefix);

  presentationOptions.forEach((button, index) => {
    const active = index === modeIndex;
    button.disabled = !prefix;
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function checkContainment() {
  containsResult.className = "contains-result";
  if (!current) {
    containsResult.textContent = "-";
    return;
  }

  const raw = containsInput.value.trim();
  if (!raw) {
    containsResult.textContent = "-";
    return;
  }

  try {
    const candidate = parsePrefix(raw);
    if (candidate.version !== current.version) {
      containsResult.textContent = `IPv${candidate.version}`;
      containsResult.classList.add("no");
      return;
    }

    const contained = candidate.network >= current.network && candidate.last <= current.last;
    containsResult.textContent = contained ? "yes" : "no";
    containsResult.classList.add(contained ? "yes" : "no");
  } catch {
    containsResult.textContent = "bad";
    containsResult.classList.add("error");
  }
}

function updateSuggestions(prefix = current) {
  const dynamic = [];
  if (prefix) {
    dynamic.push(formatPrefix(prefix));
    const parent = parentPrefix(prefix);
    const firstChild = childPrefix(prefix, false);
    const secondChild = childPrefix(prefix, true);
    if (parent) dynamic.push(formatPrefix(parent));
    if (firstChild) dynamic.push(formatPrefix(firstChild));
    if (secondChild) dynamic.push(formatPrefix(secondChild));
  }

  const values = unique([...dynamic, ...recents, ...DEFAULT_SUGGESTIONS]);
  suggestions.replaceChildren(...values.slice(0, 32).map((value) => {
    const option = document.createElement("option");
    option.value = value;
    return option;
  }));
}

function updateGhost() {
  const value = cleanPrefixInputValue();
  const lower = value.toLowerCase();
  const match = Array.from(suggestions.options)
    .map((option) => option.value)
    .find((option) => option.toLowerCase().startsWith(lower) && option.length > value.length);

  ghost.dataset.value = match || "";
  if (!match) {
    ghost.replaceChildren();
    return;
  }

  const typed = document.createElement("span");
  const suffix = document.createElement("span");
  typed.className = "ghost-prefix";
  typed.textContent = formatPrefixInputValue(value);
  suffix.textContent = formatPrefixInputValue(match.slice(value.length));
  ghost.replaceChildren(typed, suffix);
}

function resizePrefixInput() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

function rememberPrefix(value) {
  recents = unique([value, ...recents]).slice(0, 12);
  try {
    localStorage.setItem("ipcalc.recents", JSON.stringify(recents));
  } catch {
    // Browsers can deny storage in private contexts.
  }
}

function recordPrefixHistory(value) {
  const cleanValue = cleanPrefixInputValue(value).trim();
  if (!cleanValue || prefixHistory[prefixHistoryIndex] === cleanValue) return;

  prefixHistory = prefixHistory.slice(0, prefixHistoryIndex + 1);
  prefixHistory.push(cleanValue);
  if (prefixHistory.length > PREFIX_HISTORY_LIMIT) {
    prefixHistory = prefixHistory.slice(prefixHistory.length - PREFIX_HISTORY_LIMIT);
  }
  prefixHistoryIndex = prefixHistory.length - 1;
}

function commitCurrentPrefixHistory() {
  if (current) {
    recordPrefixHistory(formatInputPrefix(current));
  }
}

function beginPrefixNavigation(origin = current) {
  commitCurrentPrefixHistory();
  previousPrefixKey = prefixKey(origin);
}

function movePrefixHistory(delta) {
  const nextIndex = prefixHistoryIndex + delta;
  if (nextIndex < 0 || nextIndex >= prefixHistory.length) {
    return false;
  }

  previousPrefixKey = prefixKey(current);
  prefixHistoryIndex = nextIndex;
  setPrefixInputValue(prefixHistory[prefixHistoryIndex]);
  render();
  return true;
}

function prefixKey(prefix) {
  return prefix
    ? `${prefix.version}:${prefix.prefixLength}:${prefix.network}`
    : "";
}

function isPreviousPrefix(prefix) {
  return Boolean(previousPrefixKey && prefixKey(prefix) === previousPrefixKey);
}

function clearPreviousPrefixHighlight() {
  if (!previousPrefixKey) return;
  previousPrefixKey = "";
  render();
}

function handleMouseHistoryButton(event) {
  if (event.button !== MOUSE_BACK_BUTTON && event.button !== MOUSE_FORWARD_BUTTON) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.type !== "mousedown") return;

  const now = Date.now();
  if (event.button === lastMouseHistoryButton && now - lastMouseHistoryButtonTime < 120) return;
  commitCurrentPrefixHistory();
  const moved = movePrefixHistory(event.button === MOUSE_BACK_BUTTON ? -1 : 1);
  if (!moved) return;

  lastMouseHistoryButton = event.button;
  lastMouseHistoryButtonTime = now;
}

function loadRecents() {
  try {
    const parsed = JSON.parse(localStorage.getItem("ipcalc.recents") || "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function loadPrefixFromUrl() {
  try {
    return new URL(window.location.href).searchParams.get(URL_PREFIX_PARAM) || "";
  } catch {
    return "";
  }
}

function loadPresentationModeFromUrl() {
  try {
    const mode = new URL(window.location.href).searchParams.get(URL_VIEW_PARAM);
    return isPresentationMode(mode) ? mode : "";
  } catch {
    return "";
  }
}

function savePrefixToUrl(prefix) {
  if (!window.history?.replaceState) return;

  try {
    const url = new URL(window.location.href);
    url.searchParams.set(URL_PREFIX_PARAM, formatInputPrefix(prefix));
    url.searchParams.set(URL_VIEW_PARAM, presentationMode);
    window.history.replaceState(null, "", url);
  } catch {
    // Some embedded/file contexts can restrict URL updates.
  }
}

function savePresentationModeToUrl() {
  if (!window.history?.replaceState) return;

  try {
    const url = new URL(window.location.href);
    url.searchParams.set(URL_VIEW_PARAM, presentationMode);
    window.history.replaceState(null, "", url);
  } catch {
    // Some embedded/file contexts can restrict URL updates.
  }
}

function isPresentationMode(mode) {
  return PRESENTATION_MODES.some((item) => item.id === mode);
}

function normalizePresentationMode(mode) {
  return isPresentationMode(mode) ? mode : PRESENTATION_MODES[0].id;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "◑" : "◐";
  try {
    localStorage.setItem("ipcalc.theme", theme);
  } catch {
    // Theme persistence is a nicety, not a dependency.
  }
}

function loadTheme() {
  try {
    const saved = localStorage.getItem("ipcalc.theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Ignore storage errors and fall back to media preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function flashPanels() {
  panels.forEach((panel) => {
    panel.classList.remove("flash");
    window.requestAnimationFrame(() => {
      panel.classList.add("flash");
      window.setTimeout(() => panel.classList.remove("flash"), 120);
    });
  });
}

function formatCount(value) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatPowerOfTwoLabel(exponent) {
  const superscripts = {
    "-": "⁻",
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
  };

  return `2${String(exponent).replace(/[-0-9]/g, (digit) => superscripts[digit])}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clampBigInt(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function minBigInt(left, right) {
  return left < right ? left : right;
}

input.addEventListener("input", () => {
  syncPrefixInputWrapHints();
  previousPrefixKey = "";
  window.clearTimeout(typingTimer);
  input.classList.add("typing");
  typingTimer = window.setTimeout(() => input.classList.remove("typing"), 160);
  render();
  resizePrefixInput();
});

input.addEventListener("blur", () => {
  if (current) {
    rememberPrefix(formatPrefix(current));
    commitCurrentPrefixHistory();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && ghost.dataset.value) {
    event.preventDefault();
    setPrefixInputValue(ghost.dataset.value);
    render();
    resizePrefixInput();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (current) {
      setPrefixWithAddress(current, current.address);
    }
  }
});

containsInput.addEventListener("input", checkContainment);

presentationOptions.forEach((button) => {
  button.addEventListener("click", () => {
    setPresentationMode(button.dataset.presentation);
    button.focus();
  });
});

presentationControl.addEventListener("keydown", (event) => {
  const currentIndex = Math.max(0, PRESENTATION_MODES.findIndex((item) => item.id === presentationMode));
  const moves = {
    ArrowLeft: -1,
    ArrowUp: -1,
    ArrowRight: 1,
    ArrowDown: 1,
  };

  if (event.key === "Home") {
    event.preventDefault();
    setPresentationMode(PRESENTATION_MODES[0].id);
    presentationOptions[0].focus();
    return;
  }

  if (event.key === "End") {
    event.preventDefault();
    const last = PRESENTATION_MODES.length - 1;
    setPresentationMode(PRESENTATION_MODES[last].id);
    presentationOptions[last].focus();
    return;
  }

  if (event.key in moves) {
    event.preventDefault();
    const nextIndex = (currentIndex + moves[event.key] + PRESENTATION_MODES.length) % PRESENTATION_MODES.length;
    setPresentationMode(PRESENTATION_MODES[nextIndex].id);
    presentationOptions[nextIndex].focus();
  }
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const actions = {
      up: () => movePrefix(-1),
      down: () => movePrefix(1),
      left: () => resizePrefix(1),
      right: () => resizePrefix(-1),
    };

    actions[button.dataset.nav]?.();
  });
});

document.addEventListener("keydown", (event) => {
  if (
    event.metaKey
    || event.ctrlKey
    || event.altKey
    || event.target === containsInput
    || presentationControl.contains(event.target)
  ) return;

  const moves = {
    ArrowUp: -1,
    ArrowDown: 1,
    PageUp: -10,
    PageDown: 10,
  };

  if (event.key in moves) {
    event.preventDefault();
    movePrefix(moves[event.key]);
    return;
  }

  const resizes = {
    ArrowLeft: 1,
    ArrowRight: -1,
  };

  if (event.key in resizes) {
    if (!event.shiftKey || event.target === input) return;

    event.preventDefault();
    resizePrefix(resizes[event.key]);
  }
});

document.addEventListener("mousedown", handleMouseHistoryButton, { capture: true });
document.addEventListener("auxclick", handleMouseHistoryButton, { capture: true });

document.addEventListener("copy", (event) => {
  const selectedText = document.activeElement === input
    ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
    : window.getSelection?.().toString() || "";
  if (
    !event.clipboardData
    || (
      !selectedText.includes(INPUT_WRAP_HINT)
      && !selectedText.includes(IPV6_COMPRESSION_LIGATURE)
      && !/[:.][\r\n]+/.test(selectedText)
    )
  ) return;

  event.preventDefault();
  event.clipboardData.setData("text/plain", normalizeDisplayText(selectedText));
});

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(next);
});

window.addEventListener("resize", resizePrefixInput);

const urlPrefix = loadPrefixFromUrl();
if (urlPrefix) {
  setPrefixInputValue(urlPrefix);
} else {
  setPrefixInputValue(input.value);
}

setTheme(loadTheme());
updateSuggestions();
render();
commitCurrentPrefixHistory();
resizePrefixInput();
