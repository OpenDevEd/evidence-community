declare module "citeproc" {
  // CSL-JSON item type (simplified, expand as needed)
  export interface CSLItem {
    id: string;
    type: string;
    [key: string]: any;
  }

  // System object interface for citeproc
  export interface CiteProcSys {
    retrieveLocale: (lang: string) => string;
    retrieveItem: (id: string) => CSLItem;
  }

  // Citation cluster input
  export interface CitationClusterItem {
    id: string;
    locator?: string;
    label?: string;
    suppressAuthor?: boolean;
    prefix?: string;
    suffix?: string;
    position?: number;
  }

  // Citation cluster
  export interface CitationCluster {
    citationID: string;
    citationItems: CitationClusterItem[];
    properties?: Record<string, any>;
  }

  export class Engine {
    constructor(sys: CiteProcSys, style: string, lang?: string, forceLang?: boolean);

    updateItems(ids: string[]): void;
    processCitationCluster(
      citation: CitationCluster,
      citationsPre: CitationCluster[],
      citationsPost: CitationCluster[]
    ): [any, Array<[number, string, string]>];

    makeBibliography(): [Record<string, any>, string[]];
    // Add more methods as needed
  }
}