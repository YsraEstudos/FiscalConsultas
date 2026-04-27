import { isCodeQuery } from "../workerUtils.js";
import {
  searchNebsByCode,
  searchNebsByText,
  searchNbsByCode,
  searchNbsByText,
} from "./catalogSearch.js";
import {
  searchNeshByCode,
  searchNeshByText,
  searchTipiByCode,
  searchTipiByText,
} from "./codeSearch.js";
import {
  getCachedSearchResult,
  getSearchCacheKey,
  setCachedSearchResult,
} from "./state.js";

export function runStructuredSearch(docType, query, viewMode) {
  if (!isCodeQuery(query)) {
    switch (docType) {
      case "nbs":
        return { results: searchNbsByText(query), searchType: "text" };
      case "nebs":
        return { results: searchNebsByText(query), searchType: "text" };
      case "tipi":
      case "ncm":
        return { results: searchTipiByText(query), searchType: "text" };
      case "nesh":
        return { results: searchNeshByText(query), searchType: "text" };
      default:
        return { results: [], searchType: "text" };
    }
  }

  switch (docType) {
    case "tipi":
      return {
        results: searchTipiByCode(query, viewMode || "family").results,
        searchType: "code",
      };
    case "nesh": {
      const neshCodeResponse = searchNeshByCode(query);
      return {
        results: neshCodeResponse.results,
        searchType: "code",
        markdown: neshCodeResponse.markdown || "",
      };
    }
    case "nbs":
      return { results: searchNbsByCode(query), searchType: "text" };
    case "nebs":
      return { results: searchNebsByCode(query), searchType: "text" };
    default:
      return { results: [], searchType: "text" };
  }
}

export function getStructuredSearchWithCache(docType, query, viewMode) {
  const cacheKey = getSearchCacheKey(docType, query, viewMode);
  const cached = getCachedSearchResult(cacheKey);
  if (cached) {
    return {
      results: cached.results,
      searchType: cached.searchType,
      markdown: cached.markdown,
      cacheHit: true,
    };
  }

  const nextResult = runStructuredSearch(docType, query, viewMode);
  setCachedSearchResult(cacheKey, {
    results: nextResult.results,
    searchType: nextResult.searchType,
    markdown: nextResult.markdown,
  });

  return {
    ...nextResult,
    cacheHit: false,
  };
}
