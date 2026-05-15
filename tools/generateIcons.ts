import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';

async function main() {
    // Icons are discovered by the Next.js app router at compile time, so this
    // script has to run before `next build`. Reading companyName from the env
    // (set per-tenant in Coolify) keeps the build hermetic — no DB needed.
    const rawCompanyName = process.env.NEXT_PUBLIC_COMPANY_NAME || 'default';
    const companyName = rawCompanyName.split('|')[0].trim();

    // find /public/icons/[companyName] folder
    const iconsFolder = path.join(process.cwd(), 'public', 'logos', companyName.toLowerCase());

    // if folder does not exist, exit
    if (!fs.existsSync(iconsFolder)) {
        console.error(`Folder ${iconsFolder} does not exist`);
        process.exit(0);
    }

    // get app folder in iconsFolder and copy its contents to /src/app
    const appFolder = path.join(iconsFolder, 'app');
    if (fs.existsSync(appFolder)) {
        const targetAppFolder = path.join(process.cwd(), 'src', 'app');
        
        // First, remove existing icon files to prevent duplicates
        const existingIcons = ['icon', 'apple-icon', 'favicon'];
        const existingFiles = fs.readdirSync(targetAppFolder);
        existingFiles.forEach(file => {
            const baseName = path.basename(file, path.extname(file));
            if (existingIcons.includes(baseName)) {
                const filePath = path.join(targetAppFolder, file);
                fs.unlinkSync(filePath);
            }
        });
        
        const files = fs.readdirSync(appFolder);
        
        // Group files by base name (without extension) to detect duplicates
        const iconGroups = new Map<string, string[]>();
        files.forEach(file => {
            const ext = path.extname(file);
            const baseName = path.basename(file, ext);
            // Only handle icon files (icon, apple-icon, favicon)
            if (['icon', 'apple-icon', 'favicon'].includes(baseName)) {
                if (!iconGroups.has(baseName)) {
                    iconGroups.set(baseName, []);
                }
                iconGroups.get(baseName)!.push(file);
            }
        });
        
        // For each icon group, prefer SVG over raster formats to avoid Turbopack build error
        // (Turbopack fails when multiple icons with same name but different extensions exist)
        const filesToCopy = new Set(files);
        iconGroups.forEach((group, baseName) => {
            if (group.length > 1) {
                // Priority: .svg > .png > .ico > others
                const sortedByPreference = group.sort((a, b) => {
                    const extA = path.extname(a).toLowerCase();
                    const extB = path.extname(b).toLowerCase();
                    const priority = { '.svg': 0, '.png': 1, '.ico': 2 };
                    return (priority[extA as keyof typeof priority] ?? 99) - (priority[extB as keyof typeof priority] ?? 99);
                });
                
                // Keep only the highest priority file
                const [keep, ...remove] = sortedByPreference;
                remove.forEach(f => filesToCopy.delete(f));
                
            }
        });
        
        // Copy only the selected files
        filesToCopy.forEach(file => {
            const src = path.join(appFolder, file);
            const dest = path.join(targetAppFolder, file);
            fs.copyFileSync(src, dest);
        });
    }

    // get public folder in iconsFolder and copy its contents to /public
    const publicFolder = path.join(iconsFolder, 'public');
    if (fs.existsSync(publicFolder)) {
        fs.cpSync(publicFolder, path.join(process.cwd(), 'public'), { 
            recursive: true,
            force: true
        });
    }

}

main();