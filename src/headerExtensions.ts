import {ExifData} from "exif";

export const extensionHeaders = ['X-Image-Date', 'X-Image-Name'];

export function addImageDateHeader(exifData: ExifData, headers: any) {
    if (!!exifData) {
        const dateAndTime = exifData.exif.CreateDate.split(' ');
        return {
            ...headers,
            'X-Image-Date': `${dateAndTime[0].replace(/:/g, '.')} ${dateAndTime[1]}`
        }
    }
    return headers;
}

export function addImageNameHeader(rootFolder: string, file: string, headers: any) {
    const safeRootFolder = rootFolder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regExp = new RegExp(safeRootFolder + "\\\\(.*)\\\\(.*)");
    const matches = regExp.exec(file);
    if (matches !== null && matches.length > 0) {
        return {
            ...headers,
            'X-Image-Name': encodeURI(matches[1])
        };
    }
    return headers;
}