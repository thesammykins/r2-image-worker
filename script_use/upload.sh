#!/bin/bash

# upload.sh - Quick file upload script for R2 Image Worker
# Changes:
# - Added 1Password login check.
# - Improved curl error handling using HTTP status codes.
# - Generate timestamped filename for clipboard uploads.
# - Corrected curl line continuation.
# Requirements: 
# - 1Password CLI (op): brew install --cask 1password-cli
# - pngpaste: brew install pngpaste
# - Logged into 1Password: op signin

# Check for required tools
if ! command -v op &> /dev/null; then
    echo "Error: 1Password CLI not found"
    echo "Install it with: brew install --cask 1password-cli"
    exit 1
fi

# Check if logged into 1Password CLI
if ! op account list &> /dev/null; then
    echo "Error: Not logged into 1Password CLI. Please run 'op signin'."
    exit 1
fi

if ! command -v pngpaste &> /dev/null; then
    echo "Error: pngpaste not found"
    echo "Install it with: brew install pngpaste"
    exit 1
fi

# Configuration
UPLOAD_URL="https://upload.your.domain/upload"  # Replace with your worker URL
# Fetch auth key from 1Password - adjust the item name/field as needed
AUTH_KEY=$(op read "op://APIs/R2 Secret/credential")

if [ -z "$AUTH_KEY" ]; then
    echo "Error: Could not fetch auth key from 1Password"
    exit 1
fi

# Function to upload file
# Accepts optional second argument for desired filename
upload_file() {
    local file_path="$1"
    local desired_filename="$2"
    local upload_filename

    if [ -n "$desired_filename" ]; then
        # Use desired filename if provided
        upload_filename="$desired_filename"
    else
        # Otherwise, use the basename of the file path
        upload_filename=$(basename "$file_path")
    fi

    echo "Uploading $file_path as $upload_filename..."
    # Use -w "\n%{http_code}" to get HTTP status code, separate from body
    HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
        -H "X-Auth-Key: $AUTH_KEY" \
        -F "file=@$file_path" \
        -F "filename=$upload_filename" \
        "$UPLOAD_URL")

    # Extract body and status code
    HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d') # Get all but last line
    HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -n 1) # Get last line

    # Check HTTP status code for success (2xx range)
    if [ $? -eq 0 ] && [[ "$HTTP_STATUS" -ge 200 ]] && [[ "$HTTP_STATUS" -lt 300 ]]; then
        echo "Upload successful!"
        echo "URL: $HTTP_BODY"
        echo "$HTTP_BODY" | pbcopy
        echo "URL copied to clipboard!"
        return 0
    else
        echo "Upload failed!"
        echo "Status: $HTTP_STATUS"
        echo "Response: $HTTP_BODY"
        return 1
    fi
}

# If no arguments provided, try to upload from clipboard
if [ $# -eq 0 ]; then
    # Create temporary file for clipboard image
    TEMP_FILE=$(mktemp -t screenykins-upload).png # Use a more descriptive temp name prefix

    # Try to save clipboard content as PNG
    if pngpaste "$TEMP_FILE" 2>/dev/null && [ -s "$TEMP_FILE" ]; then # Check if pngpaste succeeded AND created a non-empty file
        # Generate a timestamped filename for the upload
        TIMESTAMP=$(date +"%Y-%m-%d_%H.%M.%S")
        GENERATED_FILENAME="Screenshot_${TIMESTAMP}.png"

        upload_file "$TEMP_FILE" "$GENERATED_FILENAME"
        RESULT=$?
        rm "$TEMP_FILE"  # Clean up temp file
        exit $RESULT
    else
        # Clean up potentially empty temp file
        [ -f "$TEMP_FILE" ] && rm "$TEMP_FILE"
        echo "Error: No image data found in clipboard or pngpaste failed."
        echo "Usage: upload.sh [file]"
        exit 1
    fi
fi

# Handle file arguments (loop through all arguments)
for FILE in "$@"; do
    if [ ! -f "$FILE" ]; then
        echo "Error: File '$FILE' not found. Skipping."
        continue # Skip to the next file if this one doesn't exist
    fi
    # Upload the provided file (without a specific desired filename, uses original)
    upload_file "$FILE"
    if [ $? -ne 0 ]; then
        echo "Failed to upload $FILE. Stopping."
        # exit 1 # Optionally exit immediately on first failure
    fi
done

# Exit with success if all files were processed (or if some were skipped but none failed critically)
exit 0
