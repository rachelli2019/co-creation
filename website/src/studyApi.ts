import {apiRequest} from './apiClient';
export function studyApi(body: Record<string, unknown>, signal?: AbortSignal) {
 return apiRequest('/api/study',body,signal);
}
