export const documentUrl = (projectId: string, requirementId: string, versionId?: string) =>
  `/projects/${projectId}/requirements/${requirementId}/document${versionId ? `?versionId=${versionId}` : ''}`;
export const documentImageUrl = (projectId: string, requirementId: string, imageId: string) =>
  `/api/v1/projects/${projectId}/requirements/${requirementId}/document/images/${imageId}/preview`;
