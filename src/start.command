#!/bin/zsh
cd "$(dirname "$0")"
npm run build
npx serve -s dist -l 4173