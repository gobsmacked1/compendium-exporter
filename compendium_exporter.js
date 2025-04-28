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
    "ownership", "_stats", "sort", "midiProperties", "folder", "tagger", "flags"
  ].join(', ');

  // Register the setting for custom excluded keys
  game.settings.register("compendium-exporter", "customExcludedKeys", {
    name: "Custom Excluded Keys (TXT Export)",
    hint: "Comma-separated list of keys to exclude from the TXT export format. Leave blank to use defaults.",
    scope: "world",
    config: true, // Makes it appear in the module settings configuration window
    default: defaultExcludedKeysString,
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

// Add customExcludedKeys parameter
async function processDocument(doc, exportYaml, exportJson, exportTxt, customExcludedKeys, zip) {
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
    // Pass customExcludedKeys to scrubHumanReadableContent
    const scrubbedData = scrubHumanReadableContent(obj, customExcludedKeys);
    const serializeToTxt = (data, indent = 0) => {
      return Object.entries(data)
        .map(([key, value]) => {
          const prefix = " ".repeat(indent);
          if (typeof value === "object" && value !== null) {
            return `${prefix}${key}:\n${serializeToTxt(value, indent + 2)}`;
          }
          return `${prefix}${key}: ${value}`;
        })
        .join("\n");
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
                               .map(key => key.trim()) // Trim whitespace
                               .filter(key => key.length > 0); // Remove empty entries

  console.log(`[Compendium Exporter] Using excluded keys for TXT: ${customExcludedKeys.join(', ')}`); // Log the keys being used

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
        await processDocument(doc, exportYaml, exportJson, exportTxt, customExcludedKeys, zip);
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

// Add customExcludedKeys parameter
function scrubHumanReadableContent(obj, customExcludedKeys) {

  // Enhanced HTML to Text Conversion Function
  const convertHtmlToText = (htmlString) => {
    if (typeof htmlString !== 'string') return '';

    let text = htmlString;
    // Basic HTML to Text Conversion (replace block tags with newlines, inline with spaces/delimiters)
    text = text.replace(/<br\s*\/?>/gi, "\n");       // Handle <br>
    text = text.replace(/<\/h[1-6]>\s*<h[1-6]>/gi, "\n"); // Add newline between consecutive headings
    text = text.replace(/<\/h[1-6]>/gi, "\n");       // Add newline after headings
    text = text.replace(/<\/p>/gi, "\n");           // Add newline after paragraphs
    text = text.replace(/<\/li>/gi, "\n");          // Add newline after list items
    text = text.replace(/<\/td>\s*<\/tr>/gi, "\n"); // Handle cell followed immediately by row end
    text = text.replace(/<\/tr>/gi, "\n");          // Add newline after table rows
    text = text.replace(/<\/td>/gi, " | ");         // Add separator after table cells
    text = text.replace(/<th>/gi, " ");            // Treat table headers like cells for spacing
    text = text.replace(/<\/th>/gi, " | ");         // Add separator after table headers

    // Strip remaining tags (like <a>, <span>, <strong>, <em>, etc.)
    text = text.replace(/<\/?[^>]+(>|$)/g, "");

    // Remove UUID references
    text = text.replace(/@UUID\[.*?\](\{[^}]*\})?/g, ""); // Remove UUIDs and optional labels like {Slippery Mind}

    // Clean up extra whitespace and newlines
    // Replace multiple spaces/tabs with a single space
    text = text.replace(/[ \t]+/g, ' ');
    // Replace lines with only whitespace (including spaces, tabs, |) with a single newline
    text = text.replace(/^[ \t\|]*$/gm, '');
    // Reduce multiple consecutive newlines to a maximum of two
    text = text.replace(/\n{3,}/g, '\n\n');
    // Trim leading/trailing whitespace/newlines
    text = text.trim();

    return text;
  };

  const isHumanReadable = (value, processedText) => {
    // Check the processed text, not the raw value
    if (typeof processedText === "string") {
      // Check if the string has content and is not too long (adjust length as needed)
      // Removed the alphanumeric check as processed text can have symbols like |
      // Increased limit significantly to allow for long descriptions
      return processedText.length > 0 && processedText.length <= 10000;
    }
    if (typeof value === "number") {
      // Check if the number is within a reasonable range and not zero
      return value >= -1_000_000_000_000 && value <= 1_000_000_000_000 && value !== 0;
    }
    // Exclude booleans unless explicitly needed
    // Exclude null/undefined implicitly
    return false;
  };

  // isKeyHumanReadable now uses the passed-in array
  const isKeyHumanReadable = key => {
    // Use the provided customExcludedKeys array
    return !customExcludedKeys.includes(key);
  };

  const scrubbed = {};
  for (const [key, value] of Object.entries(obj)) {
    // isKeyHumanReadable now uses the custom list implicitly via closure
    if (!isKeyHumanReadable(key)) {
      continue; // Skip excluded keys
    }

    if (typeof value === "object" && value !== null) {
      // Handle specific nested structures if needed, e.g., description.value
      if (key === "description" && value.hasOwnProperty("value") && typeof value.value === 'string') {
         const processedText = convertHtmlToText(value.value);
         if (isHumanReadable(value.value, processedText)) {
           scrubbed[key] = processedText;
         }
      } else {
        // Otherwise, recursively scrub nested objects, passing the keys down
        const nestedScrubbed = scrubHumanReadableContent(value, customExcludedKeys); // Pass keys recursively
        if (Object.keys(nestedScrubbed).length > 0) {
          scrubbed[key] = nestedScrubbed;
        }
      }
    } else if (typeof value === 'string') {
        // Process any string value using the HTML converter
        const processedText = convertHtmlToText(value);
        if (isHumanReadable(value, processedText)) {
            scrubbed[key] = processedText;
        }
    } else if (isHumanReadable(value, value)) { // Pass non-string value directly
        // Handle numbers that pass the check
        scrubbed[key] = value;
    }
  }
  return scrubbed;
}