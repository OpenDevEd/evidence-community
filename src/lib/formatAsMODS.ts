import type { Item } from "@/app/api/item/types";
import { create } from "xmlbuilder2";

export function formatItemAsMODS(item: Item): string {
    const doc = create({ version: "1.0", encoding: "UTF-8" });
    const mods = doc.ele("mods", { 
        xmlns: "http://www.loc.gov/mods/v3", 
        version: "3.7",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xsi:schemaLocation": "http://www.loc.gov/mods/v3 http://www.loc.gov/standards/mods/v3/mods-3-7.xsd"
    });

    // title
    if (item.title) {
        const ti = mods.ele("titleInfo");
        ti.ele("title").txt(item.title);
        if (item.shortTitle) {
            ti.ele("subTitle").txt(item.shortTitle);
        }
    }

    // names - improved structure
    if (Array.isArray(item.creators) && item.creators.length > 0) {
        for (const creator of item.creators as any[]) {
            const isOrg = !creator.lastName && !creator.firstName && !!creator.name;
            const role = (creator.creatorType || "author").toLowerCase();
            
            const name = mods.ele("name", { type: isOrg ? "corporate" : "personal" });
            
            // Better name structure
            if (isOrg) {
                name.ele("namePart").txt(creator.name);
            } else {
                if (creator.lastName) name.ele("namePart", { type: "family" }).txt(creator.lastName);
                if (creator.firstName) name.ele("namePart", { type: "given" }).txt(creator.firstName);
                // Fallback display form if needed
                if (!creator.lastName && !creator.firstName && creator.name) {
                    name.ele("namePart").txt(creator.name);
                }
            }
            
            // Include both text and code roleTerms
            const roleEl = name.ele("role");
            const roleMap: Record<string, { text: string; code: string }> = {
                author: { text: "author", code: "aut" },
                editor: { text: "editor", code: "edt" },
                translator: { text: "translator", code: "trl" },
                contributor: { text: "contributor", code: "ctb" },
                artist: { text: "artist", code: "art" },
                composer: { text: "composer", code: "cmp" },
                director: { text: "director", code: "drt" },
                performer: { text: "performer", code: "prf" },
                producer: { text: "producer", code: "pro" },
                programmer: { text: "programmer", code: "prg" },
                inventor: { text: "inventor", code: "inv" },
                interviewer: { text: "interviewer", code: "ivr" },
                interviewee: { text: "interviewee", code: "ive" },
                presenter: { text: "presenter", code: "pre" },
            };
            const roleInfo = roleMap[role] || { text: "author", code: "aut" };
            roleEl.ele("roleTerm", { type: "text", authority: "marcrelator" }).txt(roleInfo.text);
            roleEl.ele("roleTerm", { type: "code", authority: "marcrelator" }).txt(roleInfo.code);
        }
    }

    // typeOfResource - IMPORTANT for MODS validity
    const typeOfResourceMap: Record<string, string> = {
        JournalArticle: "text",
        MagazineArticle: "text",
        NewspaperArticle: "text",
        Book: "text",
        BookSection: "text",
        Thesis: "text",
        Report: "text",
        ConferencePaper: "text",
        Presentation: "text",
        Webpage: "text",
        BlogPost: "text",
        Document: "text",
        Letter: "text",
        Manuscript: "text",
        AudioRecording: "sound recording",
        Podcast: "sound recording",
        RadioBroadcast: "sound recording",
        Film: "moving image",
        VideoRecording: "moving image",
        TvBroadcast: "moving image",
        Artwork: "still image",
        Map: "cartographic",
        ComputerProgram: "software, multimedia",
        Dataset: "software, multimedia",
        Standard: "text",
    };
    const typeOfResource = typeOfResourceMap[item.itemType as keyof typeof typeOfResourceMap];
    if (typeOfResource) {
        mods.ele("typeOfResource").txt(typeOfResource);
    }

    // genre with authority
    const genreMap: Record<string, string> = {
        JournalArticle: "journal article",
        MagazineArticle: "magazine article",
        NewspaperArticle: "newspaper article",
        Book: "book",
        BookSection: "book chapter",
        Thesis: "thesis",
        Report: "report",
        Patent: "patent",
        ConferencePaper: "conference paper",
        Presentation: "presentation",
        Webpage: "web site",
        BlogPost: "blog",
        Podcast: "podcast",
        AudioRecording: "sound",
        VideoRecording: "videorecording",
        Film: "motion picture",
        Artwork: "art original",
        Map: "map",
        Letter: "letter",
        Interview: "interview",
        Dataset: "dataset",
        Standard: "standard",
    };
    const g = genreMap[item.itemType as keyof typeof genreMap];
    if (g) {
        mods.ele("genre", { authority: "marcgt" }).txt(g);
    }

    // originInfo
    if (item.place || item.publisher || item.date || item.edition) {
        const origin = mods.ele("originInfo");
        
        if (item.place) {
            origin.ele("place").ele("placeTerm", { type: "text" }).txt(item.place);
        }
        if (item.publisher) {
            origin.ele("publisher").txt(item.publisher);
        }
        if (item.date) {
            origin.ele("dateIssued").txt(item.date);
        }
        if (item.edition) {
            origin.ele("edition").txt(item.edition);
        }
    }

    // language - improved structure
    if (item.languageName) {
        const lang = mods.ele("language");
        lang.ele("languageTerm", { type: "text" }).txt(item.languageName);
        // If you have language codes, add them too:
        // lang.ele("languageTerm", { type: "code", authority: "iso639-2b" }).txt(item.languageCode);
    }

    // physicalDescription
    if (item.numPages || item.pages || item.runningTime || item.contentType) {
        const physDesc = mods.ele("physicalDescription");
        if (item.numPages) {
            physDesc.ele("extent").txt(`${item.numPages} pages`);
        }
        if (item.runningTime) {
            physDesc.ele("extent").txt(item.runningTime);
        }
        if (item.contentType) {
            physDesc.ele("internetMediaType").txt(item.contentType);
        }
    }

    // abstract
    if (item.abstractNote) {
        mods.ele("abstract").txt(item.abstractNote);
    }

    // note - additional fields
    if (item.note) {
        mods.ele("note").txt(item.note);
    }
    // if (item.extra) {
    //     mods.ele("note", { type: "additional information" }).txt(item.extra);
    // }

    // subject - for institutions
    if (Array.isArray(item.institution) && item.institution.length > 0) {
        for (const inst of item.institution) {
            const subject = mods.ele("subject");
            subject.ele("name", { type: "corporate" }).ele("namePart").txt(inst);
        }
    }

    // identifiers
    if (item.DOI) {
        mods.ele("identifier", { type: "doi" }).txt(item.DOI);
    }
    if (item.ISBN) {
        mods.ele("identifier", { type: "isbn" }).txt(item.ISBN);
    }
    if (item.ISSN) {
        mods.ele("identifier", { type: "issn" }).txt(item.ISSN);
    }
    if (item.key) {
        mods.ele("identifier", { type: "local" }).txt(item.key);
    }

    // related host for articles and sections
    const isArticle = ["JournalArticle", "MagazineArticle", "NewspaperArticle"].includes(item.itemType || "");
    const isSection = ["BookSection"].includes(item.itemType || "");
    
    if (isArticle || isSection) {
        const host = mods.ele("relatedItem", { type: "host" });
        const hostTitle = item.publicationTitle;
        
        if (hostTitle) {
            host.ele("titleInfo").ele("title").txt(hostTitle);
        }
        
        // Add ISSN to host for articles
        if (isArticle && item.ISSN) {
            host.ele("identifier", { type: "issn" }).txt(item.ISSN);
        }
        
        // Add ISBN to host for book sections
        if (isSection && item.ISBN) {
            host.ele("identifier", { type: "isbn" }).txt(item.ISBN);
        }
        
        // part information
        if (item.volume || item.issue || item.pages) {
            const part = host.ele("part");
            
            if (item.volume) {
                part.ele("detail", { type: "volume" }).ele("number").txt(item.volume);
            }
            if (item.issue) {
                part.ele("detail", { type: "issue" }).ele("number").txt(item.issue);
            }
            if (item.pages) {
                const m = (item.pages as string).match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
                const extent = part.ele("extent", { unit: "page" });
                if (m) {
                    extent.ele("start").txt(m[1]);
                    if (m[2]) extent.ele("end").txt(m[2]);
                } else {
                    extent.ele("list").txt(item.pages);
                }
            }
        }
    }

    // Series information
    if (item.seriesTitle || item.seriesNumber) {
        const series = mods.ele("relatedItem", { type: "series" });
        if (item.seriesTitle) {
            series.ele("titleInfo").ele("title").txt(item.seriesTitle);
        }
        if (item.seriesNumber) {
            series.ele("titleInfo").ele("partNumber").txt(item.seriesNumber);
        }
    }

    // location/urls
    const urls: Array<{ value: string; attrs: Record<string, string> }> = [];
    if (item.url) {
        urls.push({ 
            value: item.url, 
            attrs: { usage: "primary display", access: "object in context" } 
        });
    }
    
    // Handle PDF attachments
    if (Array.isArray(item.attachmentsData)) {
        for (const att of item.attachmentsData as any[]) {
            if (att && att.url && /pdf/i.test(att.contentType || "")) {
                urls.push({ 
                    value: att.url, 
                    attrs: { displayLabel: "PDF", access: "raw object" } 
                });
            }
        }
    }
    
    if (urls.length) {
        const loc = mods.ele("location");
        for (const u of urls) {
            loc.ele("url", u.attrs).txt(u.value);
        }
    }

    // accessCondition for rights
    if (item.rights) {
        mods.ele("accessCondition", { type: "use and reproduction" }).txt(item.rights);
    }

    // recordInfo - recommended for completeness
    const recordInfo = mods.ele("recordInfo");
    if (item.libraryCatalog) {
        recordInfo.ele("recordContentSource").txt(item.libraryCatalog);
    }

    return doc.end({ prettyPrint: true });
}
