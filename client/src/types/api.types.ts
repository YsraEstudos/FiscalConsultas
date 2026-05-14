export * from './apiCommon.types';
export * from './apiProfile.types';
export * from './apiSearch.types';
export * from './apiServices.types';
export * from './apiSystem.types';
export * from './apiAdmin.types';

import type {
    NbsCatalogSearchApiResponse,
} from './apiServices.types';
import type {
    NeshSearchApiResponse,
    TipiSearchApiResponse,
} from './apiSearch.types';

export type FiscalSearchApiResponse =
    | NeshSearchApiResponse
    | TipiSearchApiResponse
    | NbsCatalogSearchApiResponse;
