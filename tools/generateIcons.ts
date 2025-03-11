import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';

async function main() {
    const { db } = await import('@/db');

    const status = await db.query.status.findFirst();

    const companyName = status?.companyName || 'default';

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
        fs.cpSync(appFolder, path.join(process.cwd(), 'src', 'app'), { 
            recursive: true,
            force: true
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

    console.log('Icons generated successfully');
}

main();