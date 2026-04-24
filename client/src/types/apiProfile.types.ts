import type { BaseApiResponse } from './apiCommon.types';

export interface MyProfileApiResponse {
    user_id: string;
    email: string;
    full_name: string | null;
    bio: string | null;
    image_url: string | null;
    tenant_id: string;
    org_name: string | null;
    is_active: boolean;
    comment_count: number;
    pending_comment_count: number;
    approved_comment_count: number;
}

export interface UpdateMyProfileRequest {
    bio: string | null;
}

export type UserContributionStatus =
    | 'approved'
    | 'pending'
    | 'rejected'
    | 'private'
    | (string & {});

export interface UserContributionListItem {
    id: number;
    type: string;
    anchor_key: string;
    selected_text: string;
    body: string;
    status: UserContributionStatus;
    created_at: string;
    updated_at: string;
}

export interface MyContributionHistoryQuery {
    page?: number;
    page_size?: number;
    search?: string;
    status?: string;
}

export interface MyContributionHistoryApiResponse {
    items: UserContributionListItem[];
    total: number;
    has_next: boolean;
    page: number;
    page_size?: number;
}

export interface UserProfileCardApiResponse {
    user_id: string;
    full_name: string | null;
    bio: string | null;
    image_url: string | null;
    comment_count: number;
}

export interface DeleteMyAccountApiResponse extends BaseApiResponse {
    success: boolean;
    message?: string;
}
