<?php

// make_photo_thumb_run.sh でも同じ拡張子と判定条件を使うルン。
const PHOTO_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'tif', 'tiff'];
const PHOTO_CONVERT_EXTENSIONS = ['heic', 'heif', 'tif', 'tiff'];
const PHOTO_MIN_IMAGES = 8;
const PHOTO_MIN_PERCENT = 60;
const PHOTO_THUMB_SIZE = 256;

function photoListingMeta(int $files, int $images, int $videos): array
{
    $enoughImages = $images >= PHOTO_MIN_IMAGES;
    return [
        'image_count' => $images,
        'video_count' => $videos,
        'file_count' => $files,
        'is_photo_dir' => $enoughImages && $images * 100 >= ($files - $videos) * PHOTO_MIN_PERCENT,
        'show_layout_chip' => $enoughImages,
    ];
}

function photoThumbName(string $name, int $mtime): string
{
    return $name . '.' . $mtime . '.' . PHOTO_THUMB_SIZE . '.webp';
}
