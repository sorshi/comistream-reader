<?php

function normalizeImageQuality($quality, int $default = 75): int
{
    if (is_int($quality)) {
        $value = $quality;
    } elseif (is_string($quality) && preg_match('/\A(?:0|[1-9][0-9]?|100)\z/', $quality) === 1) {
        $value = (int)$quality;
    } else {
        return $default;
    }

    return ($value >= 0 && $value <= 100) ? $value : $default;
}
