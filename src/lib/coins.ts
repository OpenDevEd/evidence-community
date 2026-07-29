import type { Item, ListItem } from '@/app/api/item/types';

interface Institution {
  id?: string;
  country_code?: string;
  display_name?: string;
}

export type Author = {
  firstName?: string;
  lastName?: string;
  institution?: string;
  name?: string;
  creatorType: string;
  institutions?: Institution[];
};

/**
 * Generates COinS (ContextObjects in Spans) format for bibliographic metadata
 * Following the OpenURL Z39.88-2004 standard
 * 
 * Note: Returns empty string for non-bibliographic item types (e.g., Attachment, Note)
 */
export function generateCOinS(item: Item | ListItem): string {
  // COinS is only for bibliographic items, not attachments, notes, or annotations
  if (
    item.itemType === 'Attachment' ||
    item.itemType === 'Note' ||
    item.itemType === 'Annotation'
  ) {
    return '';
  }
  
  const params = new URLSearchParams();
  
  // Base OpenURL version
  params.append('url_ver', 'Z39.88-2004');
  params.append('ctx_ver', 'Z39.88-2004');
  
  // Determine the format and genre based on item type
  const formatAndGenre = getFormatAndGenre(item.itemType);
  params.append('rft_val_fmt', formatAndGenre.format);
  if (formatAndGenre.genre) {
    params.append('rft.genre', formatAndGenre.genre);
  }
  
  // Common fields for all types
  if (item.date) params.append('rft.date', item.date);
  if (item.url) params.append('rft_id', item.url);
  if (item.DOI) params.append('rft_id', `info:doi/${item.DOI}`);

  
  // Creators - handle Author array
  addCreators(params, item.creators as Author[]);
  
  // Item-type specific fields
  addJournalFields(params, item);
  addBookFields(params, item);
  addDissertationFields(params, item);
  addPatentFields(params, item);
  addConferenceFields(params, item);
  addAudioVisualFields(params, item);
  addLegalFields(params, item);
  addWebFields(params, item);
  
  // Identifiers
  if (item.ISBN) params.append('rft.isbn', item.ISBN);
  if (item.ISSN) params.append('rft.issn', item.ISSN);
  
  // Additional metadata
  // (Intentionally minimal per COinS KEV; omit non-standard extras)
  
  // Publisher information
  if (item.publisher) params.append('rft.publisher', item.publisher);
  if (item.place) params.append('rft.place', item.place);
  
  // Edition and series
  if (item.edition) params.append('rft.edition', item.edition);
  
  // Institution (from item.institution, not creators)
  // (Only set for dissertations via dedicated handler)
  
  // Description and notes
  // (Omitted to avoid non-standard additions)
  
  // Format as HTML span element with proper escaping
  const coinsString = params.toString();
  // Escape HTML attributes to prevent XSS
  const escapedCoinsString = coinsString
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span class="Z3988" title="${escapedCoinsString}"></span>`;
}

/**
 * Determines the appropriate OpenURL format and genre based on item type
 */
function getFormatAndGenre(itemType?: string): { format: string; genre?: string } {
  if (!itemType) {
    return { format: 'info:ofi/fmt:kev:mtx:dc' };
  }
  
  const typeMap: Record<string, { format: string; genre?: string }> = {
    // Journal articles
    'JournalArticle': { 
      format: 'info:ofi/fmt:kev:mtx:journal', 
      genre: 'article' 
    },
    'MagazineArticle': { 
      format: 'info:ofi/fmt:kev:mtx:journal', 
      genre: 'article' 
    },
    'NewspaperArticle': { 
      format: 'info:ofi/fmt:kev:mtx:journal', 
      genre: 'article' 
    },
    
    // Books
    'Book': { 
      format: 'info:ofi/fmt:kev:mtx:book', 
      genre: 'book' 
    },
    'BookSection': { 
      format: 'info:ofi/fmt:kev:mtx:book', 
      genre: 'bookitem' 
    },
    
    // Conference
    'ConferencePaper': { 
      format: 'info:ofi/fmt:kev:mtx:journal', 
      genre: 'conference' 
    },
    'Presentation': { 
      format: 'info:ofi/fmt:kev:mtx:journal', 
      genre: 'conference' 
    },
    
    // Thesis/Dissertation
    'Thesis': { 
      format: 'info:ofi/fmt:kev:mtx:dissertation', 
      genre: 'dissertation' 
    },
    
    // Reports
    'Report': { 
      format: 'info:ofi/fmt:kev:mtx:book', 
      genre: 'report' 
    },
    
    // Patents
    'Patent': { 
      format: 'info:ofi/fmt:kev:mtx:patent', 
      genre: 'patent' 
    },
    
    // Preprints
    'Preprint': { 
      format: 'info:ofi/fmt:kev:mtx:journal', 
      genre: 'preprint' 
    },
    
    // Web documents
    'Webpage': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'BlogPost': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'ForumPost': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    
    // Artwork
    'Artwork': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    
    // Audio/Video
    'AudioRecording': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'VideoRecording': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'Podcast': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'Film': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'TvBroadcast': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'RadioBroadcast': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    
    // Legal documents
    'Bill': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Case': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Hearing': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Statute': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    
    // Other document types
    'Document': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Email': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Letter': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Manuscript': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Map': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'InstantMessage': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'document' 
    },
    'Interview': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'ComputerProgram': { 
      format: 'info:ofi/fmt:kev:mtx:dc', 
      genre: 'unknown' 
    },
    'DictionaryEntry': { 
      format: 'info:ofi/fmt:kev:mtx:book', 
      genre: 'bookitem' 
    },
    'EncyclopediaArticle': {
      format: 'info:ofi/fmt:kev:mtx:book',
      genre: 'bookitem'
    },
    'Dataset': {
      format: 'info:ofi/fmt:kev:mtx:dc',
      genre: 'dataset'
    },
    'Standard': {
      format: 'info:ofi/fmt:kev:mtx:dc',
      genre: 'standard'
    }
    // Note: 'Note', 'Attachment', and 'Annotation' are excluded - they are not bibliographic items
    // and should not generate COinS metadata
  };
  
  return typeMap[itemType] || { format: 'info:ofi/fmt:kev:mtx:dc', genre: 'unknown' };
}

/**
 * Adds creator information to COinS parameters
 * Handles the Author type with proper creator type mapping
 */
function addCreators(params: URLSearchParams, creators?: Author[]) {
  if (!creators || !Array.isArray(creators) || creators.length === 0) return;
  
  // Track if we've added the first author with structured fields
  let firstAuthorAdded = false;
  
  // Separate authors by type for proper ordering
  const authors = creators.filter(c => 
    c.creatorType === 'author' || 
    c.creatorType === 'artist' || 
    c.creatorType === 'contributor'
  );
  const editors = creators.filter(c => c.creatorType === 'editor');
  const translators = creators.filter(c => c.creatorType === 'translator');
  const others = creators.filter(c => 
    c.creatorType !== 'author' && 
    c.creatorType !== 'artist' && 
    c.creatorType !== 'contributor' &&
    c.creatorType !== 'editor' && 
    c.creatorType !== 'translator'
  );
  
  // Add first author with structured fields
  if (authors.length > 0 && !firstAuthorAdded) {
    const firstAuthor = authors[0];
    if (firstAuthor.lastName) {
      params.append('rft.aulast', firstAuthor.lastName);
      firstAuthorAdded = true;
    }
    if (firstAuthor.firstName) {
      params.append('rft.aufirst', firstAuthor.firstName);
    }
    // Also add full name
    if (firstAuthor.name) {
      params.append('rft.au', firstAuthor.name);
    } else if (firstAuthor.firstName && firstAuthor.lastName) {
      params.append('rft.au', `${firstAuthor.firstName} ${firstAuthor.lastName}`);
    }
  }
  
  // Add remaining authors
  for (let i = 1; i < authors.length; i++) {
    const author = authors[i];
    const fullName = author.name || 
      (author.firstName && author.lastName 
        ? `${author.firstName} ${author.lastName}` 
        : author.lastName || author.firstName);
    
    if (fullName) {
      params.append('rft.au', fullName);
    }
  }
  
  // Add editors (OpenURL doesn't have specific editor field, use rft.au with context)
  editors.forEach(editor => {
    const fullName = editor.name || 
      (editor.firstName && editor.lastName 
        ? `${editor.firstName} ${editor.lastName}` 
        : editor.lastName || editor.firstName);
    
    if (fullName) {
      params.append('rft.au', fullName);
    }
  });
  
  // Add translators
  translators.forEach(translator => {
    const fullName = translator.name || 
      (translator.firstName && translator.lastName 
        ? `${translator.firstName} ${translator.lastName}` 
        : translator.lastName || translator.firstName);
    
    if (fullName) {
      params.append('rft.au', fullName);
    }
  });
  
  // Add other creator types
  others.forEach(creator => {
    const fullName = creator.name || 
      (creator.firstName && creator.lastName 
        ? `${creator.firstName} ${creator.lastName}` 
        : creator.lastName || creator.firstName);
    
    if (fullName) {
      params.append('rft.au', fullName);
    }
  });
}

/**
 * Adds journal-specific fields
 */
function addJournalFields(params: URLSearchParams, item: Item | ListItem) {
  const journalTypes = ['JournalArticle', 'MagazineArticle', 'NewspaperArticle'];
  
  if (!journalTypes.includes(item.itemType || '')) return;
  
  if (item.publicationTitle) {
    params.append('rft.jtitle', item.publicationTitle);
  }
  if (item.journalAbbreviation) {
    params.append('rft.stitle', item.journalAbbreviation);
  }
  if (item.volume) params.append('rft.volume', item.volume);
  if (item.issue) params.append('rft.issue', item.issue);
  
  // Parse pages
  if (item.pages) {
    const pageMatch = item.pages.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (pageMatch) {
      params.append('rft.spage', pageMatch[1]);
      if (pageMatch[2]) params.append('rft.epage', pageMatch[2]);
    } else {
      params.append('rft.pages', item.pages);
    }
  }
  
  // Article title
  if (item.title) {
    params.append('rft.atitle', item.title);
  }
}

/**
 * Adds book-specific fields
 */
function addBookFields(params: URLSearchParams, item: Item | ListItem) {
  const bookTypes = ['Book', 'BookSection', 'DictionaryEntry', 'EncyclopediaArticle'];
  
  if (!bookTypes.includes(item.itemType || '')) return;
  
  if (item.itemType === 'Book') {
    if (item.title) params.append('rft.btitle', item.title);
  }
  
  if (item.bookTitle) {
    params.append('rft.btitle', item.bookTitle);
  }
  
  // For book sections, dictionary entries, etc., add chapter/section title
  if (['BookSection', 'DictionaryEntry', 'EncyclopediaArticle'].includes(item.itemType || '')) {
    if (item.title) params.append('rft.atitle', item.title);
  }
  
  // Dictionary and encyclopedia specific
  if (item.dictionaryTitle) {
    params.append('rft.btitle', item.dictionaryTitle);
  }
  if (item.encyclopediaTitle) {
    params.append('rft.btitle', item.encyclopediaTitle);
  }
  
  if (item.numPages) params.append('rft.tpages', item.numPages);
  if (item.volume) params.append('rft.volume', item.volume);
  
  // Pages for book sections
  if (item.pages && item.itemType === 'BookSection') {
    const pageMatch = item.pages.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (pageMatch) {
      params.append('rft.spage', pageMatch[1]);
      if (pageMatch[2]) params.append('rft.epage', pageMatch[2]);
    } else {
      params.append('rft.pages', item.pages);
    }
  }
}

/**
 * Adds dissertation/thesis fields
 */
function addDissertationFields(params: URLSearchParams, item: Item | ListItem) {
  if (item.itemType !== 'Thesis') return;
  
  if (item.university) params.append('rft.inst', item.university);
  if (item.thesisType) params.append('rft.degree', item.thesisType);
  if (item.title) params.append('rft.title', item.title);
}

/**
 * Adds patent-specific fields
 */
function addPatentFields(params: URLSearchParams, item: Item | ListItem) {
  if (item.itemType !== 'Patent') return;
  
  if (item.patentNumber) params.append('rft.number', item.patentNumber);
  if (item.assignee) params.append('rft.assignee', item.assignee);
  if (item.country) params.append('rft.cc', item.country);
  if (item.applicationNumber) params.append('rft.applnumber', item.applicationNumber);
  if (item.filingDate) params.append('rft.appldate', item.filingDate);
  if (item.issueDate) params.append('rft.date', item.issueDate);
  if (item.issuingAuthority) params.append('rft.inventor', item.issuingAuthority);
}

/**
 * Adds conference-specific fields
 */
function addConferenceFields(params: URLSearchParams, item: Item | ListItem) {
  if (!['ConferencePaper', 'Presentation'].includes(item.itemType || '')) return;
  
  if (item.proceedingsTitle) {
    params.append('rft.btitle', item.proceedingsTitle);
  }
  if (item.title) {
    params.append('rft.atitle', item.title);
  }
}

/**
 * Adds audio/visual fields
 */
function addAudioVisualFields(params: URLSearchParams, item: Item | ListItem) {
  const avTypes = ['AudioRecording', 'VideoRecording', 'Film', 'Podcast', 'TvBroadcast', 'RadioBroadcast'];
  
  if (!avTypes.includes(item.itemType || '')) return;
  
  if (item.programTitle) params.append('rft.title', item.programTitle);
}

/**
 * Adds legal document fields
 */
function addLegalFields(params: URLSearchParams, item: Item | ListItem) {
  const legalTypes = ['Bill', 'Case', 'Hearing', 'Statute'];
  
  if (!legalTypes.includes(item.itemType || '')) return;
  
  // Keep strictly minimal DC-style fields
  if (item.caseName) params.append('rft.title', item.caseName);
  if (item.nameOfAct) params.append('rft.title', item.nameOfAct);
  if (item.dateDecided) params.append('rft.date', item.dateDecided);
  if (item.dateEnacted) params.append('rft.date', item.dateEnacted);
}

/**
 * Adds web document fields
 */
function addWebFields(params: URLSearchParams, item: Item | ListItem) {
  const webTypes = ['Webpage', 'BlogPost', 'ForumPost'];
  
  if (!webTypes.includes(item.itemType || '')) return;
  
  if (item.title) params.append('rft.title', item.title);
}

/**
 * Utility function to generate COinS for multiple items
 * Filters out non-bibliographic items (attachments, notes) automatically
 */
export function generateMultipleCOinS(items: Item[]): string {
  return items
    .map(item => generateCOinS(item))
    .filter(coins => coins !== '')
    .join('\n');
}

/**
 * Extracts just the COinS query string without HTML wrapper
 */
export function getCOinSQueryString(item: Item | ListItem): string {
  const fullCOinS = generateCOinS(item);
  const match = fullCOinS.match(/title="([^"]+)"/);
  return match ? match[1] : '';
}

/**
 * Generates a plain object representation of COinS parameters
 */
export function getCOinSObject(item: Item | ListItem): Record<string, string | string[]> {
  const queryString = getCOinSQueryString(item);
  const params = new URLSearchParams(queryString);
  const result: Record<string, string | string[]> = {};
  
  params.forEach((value, key) => {
    if (result[key]) {
      if (Array.isArray(result[key])) {
        (result[key] as string[]).push(value);
      } else {
        result[key] = [result[key] as string, value];
      }
    } else {
      result[key] = value;
    }
  });
  
  return result;
}

/**
 * Validates that a COinS string is properly formatted
 * Returns true for empty strings (valid for non-bibliographic items)
 */
export function validateCOinS(coinsString: string): boolean {
  // Empty string is valid (for attachments/notes that shouldn't generate COinS)
  if (coinsString === '') return true;
  
  if (!coinsString.includes('class="Z3988"')) return false;
  if (!coinsString.includes('url_ver=Z39.88-2004')) return false;
  if (!coinsString.includes('ctx_ver=Z39.88-2004')) return false;
  if (!coinsString.includes('rft_val_fmt=info:ofi/fmt:kev:mtx:')) return false;
  return true;
}
