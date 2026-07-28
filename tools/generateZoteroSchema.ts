import { writeFileSync } from "fs";
import { join } from "path";
import { columns } from "../src/db/schema/views/columns";

(async () => {
    // Fetch the Zotero schema.json from GitHub
    const zoteroSchemaUrl = "https://raw.githubusercontent.com/zotero/zotero-schema/master/schema.json";
    const response = await fetch(zoteroSchemaUrl);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch Zotero schema: ${response.status} ${response.statusText}`);
    }
    
    const zoteroSchema = await response.json();
    
    if (!zoteroSchema.csl) {
        throw new Error("No CSL property found in Zotero schema");
    }
    
    // Update the local csl.json file with the CSL data from Zotero schema
    const cslPath = join(process.cwd(), "public", "csl.json");
    writeFileSync(cslPath, JSON.stringify(zoteroSchema.csl, null, 2));
    
    // Fetch the APA CSL style file
    const apaCslUrl = "https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl";
    const apaCslResponse = await fetch(apaCslUrl);
    
    if (!apaCslResponse.ok) {
        throw new Error(`Failed to fetch APA CSL style: ${apaCslResponse.status} ${apaCslResponse.statusText}`);
    }
    
    const apaCslContent = await apaCslResponse.text();
    
    // Save APA CSL style to public folder
    const apaCslPath = join(process.cwd(), "public", "apa.csl");
    writeFileSync(apaCslPath, apaCslContent);
    
    // Now use the updated CSL data to generate schema
    const csl = zoteroSchema.csl;
    
    const schema = {
        CSL_TYPE_MAPPINGS: {} as Record<string, string>,
        CSL_TYPE_MAPPINGS_REVERSE: {} as Record<string, string[]>,
        CSL_TEXT_MAPPINGS: csl.fields.text,
        CSL_DATE_MAPPINGS: csl.fields.date,
        CSL_NAME_MAPPINGS: csl.names,
        CSL_FIELD_MAPPINGS_REVERSE: {} as Record<string, string>,
        COLUMN_TO_ZOTERO_TYPE_MAPPINGS: {} as Record<string, string>
    };

    // Build type mappings
    // Create a lowercase lookup map for columns
    const columnKeysLowercase = Object.keys(columns).reduce((acc, key) => {
        acc[key.toLowerCase()] = key;
        return acc;
    }, {} as Record<string, string>);

    for (const cslType in csl.types) {
        const zoteroTypes = csl.types[cslType as keyof typeof csl.types];
        for (const zoteroType of zoteroTypes) {
            // Check if zoteroType (in lowercase) matches a key in columns (in lowercase)
            const matchingColumnKey = columnKeysLowercase[zoteroType.toLowerCase()];
            const keyToUse = matchingColumnKey || zoteroType;
            
            schema.CSL_TYPE_MAPPINGS[keyToUse] = cslType;
            
            // If we used a column key, map it back to the original Zotero type
            if (matchingColumnKey) {
                schema.COLUMN_TO_ZOTERO_TYPE_MAPPINGS[matchingColumnKey] = zoteroType;
            }
        }
        schema.CSL_TYPE_MAPPINGS_REVERSE[cslType] = [...zoteroTypes];
    }

    // Build field mappings reverse for text fields
    for (const cslField in csl.fields.text) {
        const zoteroFields = csl.fields.text[cslField as keyof typeof csl.fields.text];
        for (const zoteroField of zoteroFields) {
            schema.CSL_FIELD_MAPPINGS_REVERSE[zoteroField] = cslField;
        }
    }

    // Build field mappings reverse for date fields
    for (const cslField in csl.fields.date) {
        const zoteroField = csl.fields.date[cslField as keyof typeof csl.fields.date];
        schema.CSL_FIELD_MAPPINGS_REVERSE[zoteroField] = cslField;
    }

    // Write schema to JSON file
    const schemaPath = join(process.cwd(), "public", "schema.json");
    writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
})();
