#!/usr/bin/env bash
# probably use git submodules for this

SUB_PROJ_DIR="../dataparse/src/main/resources/assets/js/lib/gcs-browser-upload"
npm run build
cp out/gcs-browser-upload.js ${SUB_PROJ_DIR}
