export const transformPostFindingsAsReviewComment = (value: string): string => {
    if (value === 'true') return 'on';
    if (value === 'false') return 'off';
    return value;
}
