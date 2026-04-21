import type {
    DeleteMyAccountApiResponse,
    MyContributionHistoryApiResponse,
    MyContributionHistoryQuery,
    MyProfileApiResponse,
    UpdateMyProfileRequest,
    UserProfileCardApiResponse,
} from '../../types/api.types';

import { api, withDevCacheBust } from './httpClient';

export const getMyProfile = async (): Promise<MyProfileApiResponse> => {
    const response = await api.get<MyProfileApiResponse>(withDevCacheBust('/profile/me'));
    return response.data;
};

export const updateMyProfile = async (data: UpdateMyProfileRequest): Promise<MyProfileApiResponse> => {
    const response = await api.patch<MyProfileApiResponse>('/profile/me', data);
    return response.data;
};

export const getMyContributions = async (
    params: MyContributionHistoryQuery,
): Promise<MyContributionHistoryApiResponse> => {
    const response = await api.get<MyContributionHistoryApiResponse>('/profile/me/contributions', {
        params: import.meta.env.DEV
            ? { ...params, _dev_bust: Date.now() }
            : params,
    });
    return response.data;
};

export const getUserCard = async (userId: string): Promise<UserProfileCardApiResponse> => {
    const response = await api.get<UserProfileCardApiResponse>(
        withDevCacheBust(`/profile/${encodeURIComponent(userId)}/card`),
    );
    return response.data;
};

export const deleteMyAccount = async (): Promise<DeleteMyAccountApiResponse> => {
    const response = await api.delete<DeleteMyAccountApiResponse>('/profile/me');
    return response.data;
};
