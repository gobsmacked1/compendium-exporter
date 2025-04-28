# Compendium Exporter for Foundry VTT

Exports selected compendium documents into YAML, JSON, and/or human-readable TXT files, packaged into convenient ZIP archives. Useful for backups, external processing, or feeding data into other tools (like AI embeddings).

## Features

*   **Multiple Formats:** Export compendium documents as YAML, JSON, or a scrubbed, human-readable TXT format.
*   **Selective Export:** Choose which compendiums to export via a simple UI.
*   **Batch Processing:** Exports are automatically split into manageable ZIP files based on a configurable batch size to prevent browser issues with large compendiums.
*   **Configurable:**
    *   Enable/disable YAML, JSON, and TXT export formats individually.
    *   Set the number of documents per ZIP batch.
    *   Customize the list of keys to exclude from the TXT export for cleaner output.
    *   Configure a minimum wait time between processing documents (useful on slower systems).
*   **Client-Side Processing:** All processing happens in your browser.
*   **Halt Button:** Stop an ongoing export process if needed.

## Installation

1.  Go to the Add-on Modules tab in Foundry VTT.
2.  Click "Install Module".
3.  In the "Manifest URL" field, paste the following URL:
    ```
    https://github.com/gobsmacked1/compendium-exporter/releases/latest/download/module.json
    ```
4.  Click "Install".
5.  Enable the "Compendium Exporter" module in your World Settings.

## Usage

1.  Ensure you are logged in as a GM user.
2.  Navigate to the "Compendium Packs" tab in the sidebar.
3.  At the bottom of the compendium list, click the "Compendium Exporter" button.
4.  A dialog window will appear. Select the compendiums you wish to export.
5.  Click the "Export Selected" button.
6.  ZIP files containing the exported documents will be downloaded by your browser. Depending on the number of documents and the batch size setting, multiple ZIP files may be downloaded sequentially.

## Configuration

Module settings can be configured in the Foundry VTT Setup screen under "Configure Settings" > "Module Settings" > "Compendium Exporter".

*   **Minimum Wait (ms) Between Processing:** Time in milliseconds to wait between processing individual documents. Default: `0`.
*   **Export Batch Size:** Number of documents to include in each ZIP file. Default: `100`.
*   **Export as YAML:** Enable/disable YAML export. Default: `true`.
*   **Export as JSON:** Enable/disable JSON export. Default: `false`.
*   **Export as TXT:** Enable/disable human-readable TXT export. Default: `false`.
*   **Custom Excluded Keys (TXT Export):** A comma-separated list of top-level and nested keys to exclude specifically from the TXT output format. This helps create cleaner text for human reading or AI ingestion. Edit this list to fine-tune the TXT output.

## TXT Export Scrubbing

The TXT export format attempts to create a human-readable representation of the document data. It performs the following scrubbing:

*   Removes most technical/metadata keys (configurable via settings).
*   Converts basic HTML content (paragraphs, lists, headings, tables) into formatted text.
*   Removes complex HTML tags while retaining inner text.
*   Removes Foundry VTT specific `@UUID` references.
*   Cleans up excessive whitespace.

## Compatibility

*   **Minimum Foundry VTT Version:** 11
*   **Verified Foundry VTT Version:** 12 

## Support & Issues

Please report any bugs or issues, or suggest features, via the [GitHub Issues page](https://github.com/gobsmacked1/compendium-exporter/issues).

## License

`This project is licensed under the MIT License - see the LICENSE.txt file for details.`
