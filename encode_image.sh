#!/bin/bash

# Check if an image file is provided
if [ $# -lt 1 ]; then
    echo "Usage: $0 <image_file> [output_file]"
    echo "Example: $0 test.png base64_output.txt"
    exit 1
fi

IMAGE_FILE="$1"
OUTPUT_FILE="${2:-}"  # Use the second argument as output file, if provided

# Check if the image file exists
if [ ! -f "$IMAGE_FILE" ]; then
    echo "Error: Image file '$IMAGE_FILE' does not exist."
    exit 1
fi

# Get the file extension and determine MIME type
FILE_EXT="${IMAGE_FILE##*.}"
MIME_TYPE="application/octet-stream"  # Default MIME type

case "$FILE_EXT" in
    png|PNG)
        MIME_TYPE="image/png"
        ;;
    jpg|jpeg|JPG|JPEG)
        MIME_TYPE="image/jpeg"
        ;;
    gif|GIF)
        MIME_TYPE="image/gif"
        ;;
    webp|WEBP)
        MIME_TYPE="image/webp"
        ;;
    *)
        echo "Warning: Unknown file extension. Using generic MIME type."
        ;;
esac

# Convert image to base64
echo "Converting '$IMAGE_FILE' to base64..."

# Different commands based on OS
if [ "$(uname)" == "Darwin" ]; then
    # macOS
    BASE64_DATA="data:$MIME_TYPE;base64,$(base64 -i "$IMAGE_FILE")"
else
    # Linux and others
    BASE64_DATA="data:$MIME_TYPE;base64,$(base64 -w 0 "$IMAGE_FILE")"
fi

# Output the base64 data
if [ -n "$OUTPUT_FILE" ]; then
    # Save to file if output file is specified
    echo "$BASE64_DATA" > "$OUTPUT_FILE"
    echo "Base64 data saved to '$OUTPUT_FILE'"
    echo "Total length: ${#BASE64_DATA} characters"
else
    # Display a preview and length if no output file
    echo "Base64 Image Data (first 100 chars):"
    echo "${BASE64_DATA:0:100}..."
    echo "Total length: ${#BASE64_DATA} characters"
    
    echo ""
    echo "To use with MCP server in multi_image_analysis:"
    echo '{
  "images": [
    {
      "url": "'"${BASE64_DATA:0:20}"'... (full base64 string)"
    }
  ],
  "prompt": "Please describe this image in detail. What does it show?",
  "model": "qwen/qwen2.5-vl-32b-instruct:free"
}'
fi

exit 0 