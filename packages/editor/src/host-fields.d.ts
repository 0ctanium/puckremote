/**
 * Host-owned field UIs (the only "custom" fields that exist). Blocks reference them by name
 * (host:color, host:media, host:link); no developer code runs in the fields panel.
 */
import type { CustomField } from '@puckeditor/core';
export declare const colorField: (fieldLabel?: string) => CustomField<string | undefined>;
type Media = {
    url: string;
    alt?: string;
};
export declare const mediaField: (fieldLabel?: string) => CustomField<Media | undefined>;
type Link = {
    href: string;
    label?: string;
    newTab?: boolean;
};
export declare const linkField: (fieldLabel?: string) => CustomField<Link | undefined>;
export {};
