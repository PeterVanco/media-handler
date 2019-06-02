import {ExifData} from "exif";
import * as path from "path";

export const extensionHeaders = ['X-Image-Date', 'X-Image-Name'];

export function addImageDateHeader(exifData: ExifData, headers: any) {
    let xImageDate = '';
    if (!!exifData && !!exifData.exif && !!exifData.exif.CreateDate) {
        const dateAndTime = exifData.exif.CreateDate.split(' ');
        xImageDate = `${dateAndTime[0].replace(/:/g, '.')} ${dateAndTime[1]}`;
    }
    return {
        ...headers,
        'X-Image-Date': xImageDate
    }
}

export function addImageNameHeader(rootFolder: string, file: string, headers: any) {
    let xImageName = '';
    const rootFolderParts = rootFolder.split(path.sep);
    const fileParts = file.split(path.sep);
    if (fileParts.length > rootFolderParts.length) {
        xImageName = encodeURI(fileParts[rootFolderParts.length]);
    }
    return {
        ...headers,
        'X-Image-Name': xImageName
    };
}