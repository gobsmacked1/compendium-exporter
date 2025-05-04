Hooks.once("ready", async function () {
  console.log("[Compendium Exporter] Module loaded and ready.");
  if (!game.user.isGM) return;

  game.settings.register("compendium-exporter", "minWaitMs", {
    name: "Minimum Wait (ms) Between Processing",
    hint: "Configure how many milliseconds to wait between processing individual documents.",
    scope: "world",
    config: true,
    default: 0,
    type: Number
  });

  game.settings.register("compendium-exporter", "batchSize", {
    name: "Export Batch Size",
    hint: "Configure the number of documents to include in each generated ZIP file. Must be a positive integer.",
    scope: "world",
    config: true,
    default: 100,
    type: Number
  });

  game.settings.register("compendium-exporter", "exportYaml", {
    name: "Export as YAML",
    hint: "Enable or disable exporting compendiums as YAML files.",
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register("compendium-exporter", "exportJson", {
    name: "Export as JSON",
    hint: "Enable or disable exporting compendiums as JSON files.",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("compendium-exporter", "exportTxt", {
    name: "Export as TXT",
    hint: "Enable or disable exporting compendiums as TXT files (human-readable).",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  // Define the default excluded keys
  const defaultExcludedKeysString = [
    "_id", "uuid", "key", "group", "img", "startingEquipment", "tint", 
    "chris-premades", "betterRolls5e", "midi-qol", "magicitems", 
    "prototypeToken", "ActiveAuras", "scene-packer", "ddbimporter", "dae", 
    "ownership", "_stats", "sort", "midiProperties", "folder", "tagger", 
    "video", "src", "format", "token", "url", "tokenImg", "titleHTML", 
    "navigation", "dnd5e", "autoanimations", "itemacro", "walledtemplates", 
    "sound"
  ].join(', ');

  // Register the setting for custom excluded keys
  game.settings.register("compendium-exporter", "customExcludedKeys", {
    name: "Custom Excluded Keys (TXT Export)",
    hint: "Comma-separated list of keys to exclude from the TXT export format. Leave blank to use defaults.",
    scope: "world",
    config: true,
    default: defaultExcludedKeysString,
    type: String
  });

  // Define the default patterns/strings to exclude from TXT values
  const defaultExcludedStrings = [
    "@UUID[",
    "@Embed[",
    "@Compendium[",
    "&Reference[",
    //"[[", // Matches [[/r ...]], [[/check ...]], etc.
    //"Compendium.", // Matches Compendium.<pack>.<entity>
    //"game.", // Matches game.actors, game.items etc. often found in formulas/scripts
    "CONFIG.", // Matches CONFIG.DND5E... etc.
    "rollData.",
    //"abilities.",
    //"skills.",
    //"token.",
    //"actor.",
    //"item.",
    "----", // Common separator line pattern
    "====", // Common separator line pattern
    "****", // Common separator line pattern
    "____" // Common separator line pattern
    // Add other simple literal strings or prefixes here if needed
  ];
  const defaultExcludedStringsSetting = defaultExcludedStrings.join(', ');

  // Register the setting for custom excluded strings/patterns
  game.settings.register("compendium-exporter", "customExcludedStrings", {
    name: "Custom Excluded Strings (TXT Export)",
    hint: "Comma-separated list of literal strings or simple prefixes. Text values containing any of these will be excluded from TXT export. Default includes common Foundry patterns.",
    scope: "world",
    config: true,
    default: defaultExcludedStringsSetting,
    type: String
  });

  game.settings.registerMenu("compendium-exporter", "exportMenu", {
    name: "Export Compendiums",
    label: "Export Now",
    hint: "Select which compendiums to export as a single ZIP of YAML, JSON, and/or TXT files",
    icon: "fas fa-file-export",
    type: CompendiumExporterMenu,
    restricted: true
  });
});

class CompendiumExporterMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "compendium-exporter-menu",
      title: "Compendium Exporter",
      template: "modules/compendium-exporter/templates/compendium-exporter-form.html",
      width: 600,
      height: "auto",
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false,
    });
  }

  getData() {
    console.log("[Compendium Exporter] Gathering compendium list for UI...");
    const packs = Array.from(game.packs).filter(p => p.documentName);
    return {
      packs: packs.map(p => ({
        id: p.collection,
        label: p.title || p.metadata?.label || p.collection,
        shortLabel: (p.title || p.metadata?.label || p.collection).substring(0, 16)
      }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    let haltExport = false;

    html.find("button[name='export']").click(async ev => {
      ev.preventDefault();
      haltExport = false; // Reset halt flag when starting a new export
      const form = ev.target.closest("form");
      if (!form) {
        handleError("Could not find parent form element", null);
        return;
      }

      const selected = Array.from(form.querySelectorAll("input[name='packs']:checked")).map(i => i.value);

      // Retrieve export format options from Foundry settings
      const exportYaml = game.settings.get("compendium-exporter", "exportYaml");
      const exportJson = game.settings.get("compendium-exporter", "exportJson");
      const exportTxt = game.settings.get("compendium-exporter", "exportTxt");

      if (selected.length === 0) {
        ui.notifications.warn("Please select at least one compendium to export.");
        return;
      }

      if (!exportYaml && !exportJson && !exportTxt) {
        ui.notifications.warn("Please select at least one export format (YAML, JSON, or TXT).");
        return;
      }

      await exportCompendiumsClientSide(selected, exportYaml, exportJson, exportTxt, () => haltExport);
    });

    html.find("button[name='halt']").click(ev => {
      ev.preventDefault();
      haltExport = true; // Set halt flag to true
      ui.notifications.warn("Export process halted by user.");
    });
  }

  async _updateObject(event, formData) {
    // No changes needed here for this request
  }
}

// Helper function to sanitize parts of the filename
const sanitizeFilenamePart = (name) => {
  const sanitized = (name || "Unnamed").replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 255);
  return sanitized || "Unnamed";
};

// Update processDocument signature
async function processDocument(doc, exportYaml, exportJson, exportTxt, customExcludedKeys, customExcludedStrings, zip) {
  const obj = doc.toObject();
  const safeDocName = sanitizeFilenamePart(doc.name);
  const docType = sanitizeFilenamePart(doc.documentName || 'UnknownType');
  const docId = doc.id || doc._id || 'UnknownID';
  const baseFilename = `${safeDocName}_${docType}_${docId}`;

  if (exportYaml) {
    const yamlData = jsyaml.dump(obj);
    zip.file(`${baseFilename}.yaml`, yamlData);
  }

  if (exportJson) {
    const jsonData = JSON.stringify(obj, null, 2);
    zip.file(`${baseFilename}.json`, jsonData);
  }

  if (exportTxt) {
    // Step 1: Prune empty keys/branches
    let scrubbedData = scrubHumanReadableContent(obj, customExcludedKeys, customExcludedStrings);
    scrubbedData = pruneEmptyKeys(scrubbedData);

    // Step 2: Collapse whitespace during serialization
    const serializeToTxt = (data, indent = 0) => {
      if (typeof data === "object" && data !== null) {
        return Object.entries(data)
          .map(([k, v]) =>
            " ".repeat(indent) +
            k +
            ": " +
            (typeof v === "object" && v !== null
              ? "\n" + serializeToTxt(v, indent + 2)
              : collapseWhitespace(String(v)))
          )
          .join("\n");
      }
      return collapseWhitespace(String(data));
    };

    const txtData = serializeToTxt(scrubbedData);
    zip.file(`${baseFilename}.txt`, txtData);
  }
}

// Helper to finalize and download a ZIP batch
async function finalizeBatch(zip, safeCompendium, batchNumber) {
  console.log(`Generating ZIP for batch ${batchNumber} of compendium ${safeCompendium}`);
  try {
    const content = await zip.generateAsync({ type: "blob" });
    const filename = `${safeCompendium}_batch_${batchNumber}.zip`;

    const file = new File([content], filename, { type: "application/zip" });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(link.href), 100);
    console.log(`Batch ${batchNumber} finalized and download triggered as ${filename}.`);
  } catch (err) {
    handleError(`Failed to finalize batch ${batchNumber}`, err);
  }
}

// Helper to validate batch size
function validateBatchSize(batchSize) {
  if (isNaN(batchSize) || batchSize < 1 || !Number.isInteger(batchSize)) {
    throw new Error("Batch size must be a positive integer.");
  }
}

// Main export function
async function exportCompendiumsClientSide(selectedKeys, exportYaml, exportJson, exportTxt, shouldHalt) {
  console.log(`[Compendium Exporter] Starting export of ${selectedKeys.length} compendiums. YAML: ${exportYaml}, JSON: ${exportJson}, TXT: ${exportTxt}`);

  // Get and parse custom excluded keys from settings
  const customExcludedKeysSetting = game.settings.get("compendium-exporter", "customExcludedKeys");
  const customExcludedKeys = customExcludedKeysSetting.split(',')
                               .map(key => key.trim())
                               .filter(key => key.length > 0);
  console.log(`[Compendium Exporter] Using excluded keys for TXT: ${customExcludedKeys.join(', ')}`);

  // Get and parse custom excluded strings from settings
  const customExcludedStringsSetting = game.settings.get("compendium-exporter", "customExcludedStrings");
  const customExcludedStrings = customExcludedStringsSetting.split(',')
                                  .map(str => str.trim())
                                  .filter(str => str.length > 0);
  if (customExcludedStrings.length > 0) {
    console.log(`[Compendium Exporter] Using custom excluded strings for TXT: ${customExcludedStrings.join(', ')}`);
  }


  const total = selectedKeys.length;
  let count = 0;

  for (const key of selectedKeys) {
    if (shouldHalt()) {
      console.warn("[Compendium Exporter] Export halted by user.");
      ui.notifications.warn("Export process halted.");
      return;
    }

    console.log(`[Compendium Exporter] Processing compendium: ${key}`);
    const pack = game.packs.get(key);
    if (!pack || !pack.documentName) {
      console.warn(`[Compendium Exporter] Skipped invalid or empty pack: ${key}`);
      continue;
    }

    const safeCompendium = sanitizeFilenamePart(key);

    try {
      const documentIds = pack.index.map(entry => entry._id);
      let docsInCurrentBatch = 0;
      let batchNumber = 1;
      let zip = new JSZip();

      for (const docId of documentIds) {
        if (shouldHalt()) {
          console.warn("[Compendium Exporter] Export halted by user.");
          ui.notifications.warn("Export process halted.");
          return;
        }

        const doc = await pack.getDocument(docId);
        // Pass customExcludedStrings to processDocument
        await processDocument(doc, exportYaml, exportJson, exportTxt, customExcludedKeys, customExcludedStrings, zip);
        docsInCurrentBatch++;

        if (docsInCurrentBatch >= 100) {
          await finalizeBatch(zip, safeCompendium, batchNumber++);
          zip = new JSZip();
          docsInCurrentBatch = 0;
        }
      }

      if (docsInCurrentBatch > 0) {
        await finalizeBatch(zip, safeCompendium, batchNumber);
      }

      count++;
    } catch (err) {
      handleError(`Failed to export ${key}`, err);
    }
  }

  console.log("[Compendium Exporter] ✅ Export complete!");
}

async function delayIfNeeded(ms) {
  if (ms > 0) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

function handleError(message, error) {
  console.error(`[Compendium Exporter] ${message}`, error);
  ui.notifications.error(`${message}. Check the console (F12) for details.`);
}

function notifyProgress(message, count, total) {
  ui.notifications.info(`${message} (${count}/${total})`);
}

// Updated HTML to Text Conversion Function - Replaces [[...]] with [...]
const convertHtmlToText = (htmlString) => {
  if (typeof htmlString !== 'string' || !htmlString.trim()) return '';

  let text = '';
  try {
    // ... (DOM parsing and extractText helper remain the same) ...
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const extractText = (node) => {
      // ... (extractText function remains the same) ...
      let result = '';
      const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'ul', 'ol', 'li', 'table', 'tr', 'th', 'td', 'blockquote', 'pre', 'br', 'hr']);

      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          result += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
           const tagName = child.tagName.toLowerCase();
           if (blockTags.has(tagName) && result.length > 0 && !/\s$/.test(result)) {
               result += ' ';
           }
           result += extractText(child);
           if (blockTags.has(tagName) && result.length > 0 && !/\s$/.test(result)) {
               result += ' ';
           }
        }
      }
      return result;
    };
    text = extractText(doc.body);


    // Replace Non-Breaking Spaces (NBSP) with regular spaces FIRST
    text = text.replace(/\u00A0/g, ' ');

    // --- Pattern Removal/Replacement Section ---
    // Remove common Foundry patterns AFTER text extraction
    text = text.replace(/@UUID\[.*?\]({[^}]*})?/g, "");
    text = text.replace(/@Embed\[.*?\]({[^}]*})?/g, "");
    text = text.replace(/@Compendium\[.*?\]({[^}]*})?/g, "");
    text = text.replace(/&Reference\[.*?\]({[^}]*})?/g, ""); // Remove &Reference links
    // Replace [[content]] with [content] using a capturing group
    text = text.replace(/\[\[(.*?)\]\]/g, '[$1]');

    // --- End Pattern Removal/Replacement ---

  } catch (e) {
    console.warn("[Compendium Exporter] Error parsing HTML string with DOMParser, falling back:", e, htmlString);
    // Fallback logic
    text = htmlString;
    // ... (other fallback replacements) ...
    text = text.replace(/@UUID\[.*?\]({[^}]*})?/g, "");
    text = text.replace(/@Embed\[.*?\]({[^}]*})?/g, "");
    text = text.replace(/@Compendium\[.*?\]({[^}]*})?/g, "");
    text = text.replace(/&Reference\[.*?\]({[^}]*})?/g, "");
    // Apply the same replacement in the fallback
    text = text.replace(/\[\[(.*?)\]\]/g, '[$1]');
    // ... (rest of fallback replacements) ...
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/\u00A0/g, ' ');
    text = text.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
  }

  // Final cleanup of whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.replace(/^\s+|\s+$/g, '');

  return text; // Return the cleaned text
};

// isNaturalLanguageString remains the same (checks custom list + regex rules)
const isNaturalLanguageString = (text, customExcludedStrings) => {
    // ... (existing code including check against customExcludedStrings and regex rules 1-8) ...
    if (typeof text !== 'string' || !text) return false;

    // Rule 0: Check against custom excluded strings first
    if (customExcludedStrings && customExcludedStrings.length > 0) {
        for (const excludedStr of customExcludedStrings) {
            // Check if the *cleaned* text still contains an excluded string/prefix
            if (text.includes(excludedStr)) {
                // console.log(`[Scrub] Excluding text containing custom string: "${excludedStr}" in "${text.substring(0, 50)}..."`);
                return false;
            }
        }
    }
    // ... (Rules 1-8) ...
    if (/@(Embed|UUID|Compendium)\[.*?\]/.test(text)) return false;
    if (/\bCompendium\.[a-zA-Z0-9_-]{3,}\.[a-zA-Z0-9_-]{3,}/.test(text)) return false;
    if (/\b[a-z-]+\.[A-Z][a-zA-Z]+.[a-zA-Z0-9]{10,}/.test(text)) return false;
    if (/[^a-zA-Z0-9\s.,!?;:'"-]{4,}/.test(text)) return false;
    if (/[\[\]{}<>]/.test(text) && text.length < 100) return false;
    if (/---{2,}/.test(text)) return false;
    if (/[a-zA-Z0-9._-]{25,}/.test(text) && !/\s/.test(text)) return false;
    if (/&[a-zA-Z]+;/g.test(text)) return false;
    if (/\b[a-zA-Z_-]+\.[a-zA-Z_-]+/.test(text) && text.length < 50 && !text.includes(' ')) return false;

    return true;
};


// isHumanReadable remains the same
const isHumanReadable = (value, processedValue) => {
    // ... (existing code) ...
    if (typeof processedValue === "string") {
        return processedValue.length > 0 && processedValue.length <= 100000;
    }
    if (typeof value === "number") {
        return value >= -1_000_000_000_000 && value <= 1_000_000_000_000 && value !== 0;
    }
    return false;
};


// Update scrubHumanReadableContent to use the modified convertHtmlToText
function scrubHumanReadableContent(obj, customExcludedKeys, customExcludedStrings) {

  const isKeyHumanReadable = key => {
    return !customExcludedKeys.includes(key);
  };

  const scrubbed = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isKeyHumanReadable(key)) {
      continue;
    }

    if (typeof value === "object" && value !== null) {
      if (key === "description" && value.hasOwnProperty("value") && typeof value.value === 'string') {
         // convertHtmlToText now only takes the HTML string
         const processedText = convertHtmlToText(value.value);
         // Check basic readability AND natural language (which checks customExcludedStrings)
         if (isHumanReadable(processedText, processedText) && isNaturalLanguageString(processedText, customExcludedStrings)) {
           scrubbed[key] = processedText;
         }
      } else {
        // Pass customExcludedStrings recursively for isNaturalLanguageString checks deeper down
        const nestedScrubbed = scrubHumanReadableContent(value, customExcludedKeys, customExcludedStrings);
        if (Object.keys(nestedScrubbed).length > 0) {
          scrubbed[key] = nestedScrubbed;
        }
      }
    } else if (typeof value === 'string') {
        // convertHtmlToText now only takes the HTML string
        const processedText = convertHtmlToText(value);
        // Check basic readability AND natural language (which checks customExcludedStrings)
        if (isHumanReadable(processedText, processedText) && isNaturalLanguageString(processedText, customExcludedStrings)) {
            scrubbed[key] = processedText;
        }
    } else if (isHumanReadable(value, value)) { // Check non-string, non-object values (like numbers)
        scrubbed[key] = value;
    }
  }
  return scrubbed;
}

// Recursively remove keys with no value and no non-empty children
function pruneEmptyKeys(obj) {
  if (Array.isArray(obj)) {
    // Clean each item in the array
    const cleaned = obj.map(pruneEmptyKeys).filter(
      v => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")
    );
    return cleaned.length > 0 ? cleaned : undefined;
  } else if (typeof obj === "object" && obj !== null) {
    const cleaned = {};
    for (const [k, v] of Object.entries(obj)) {
      const pruned = pruneEmptyKeys(v);
      if (
        pruned !== undefined &&
        pruned !== null &&
        !(typeof pruned === "string" && pruned.trim() === "") &&
        !(typeof pruned === "object" && Object.keys(pruned).length === 0)
      ) {
        cleaned[k] = pruned;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  // For primitives, return as-is
  return obj;
}

function collapseWhitespace(str) {
  // Replace all runs of whitespace (space, tab, form feed, etc.) with a single space
  return typeof str === "string"
    ? str.replace(/[\s\f]+/g, " ").trim()
    : str;
}