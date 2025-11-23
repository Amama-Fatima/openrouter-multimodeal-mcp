#!/usr/bin/env python3
import base64
import argparse
import os
import sys
from pathlib import Path


def convert_image_to_base64(image_path):
    """Convert an image file to base64 encoding with data URI prefix"""
    # Get file extension and determine mime type
    file_ext = os.path.splitext(image_path)[1].lower()
    mime_type = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
    }.get(file_ext, 'application/octet-stream')
    
    # Read binary data and encode to base64
    try:
        with open(image_path, 'rb') as img_file:
            img_data = img_file.read()
            base64_data = base64.b64encode(img_data).decode('utf-8')
            return f"data:{mime_type};base64,{base64_data}"
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return None


def save_base64_to_file(base64_data, output_path):
    """Save base64 data to a file"""
    try:
        with open(output_path, 'w') as out_file:
            out_file.write(base64_data)
        print(f"Base64 data saved to {output_path}")
        return True
    except Exception as e:
        print(f"Error saving file: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description='Convert image to base64 for MCP server testing')
    parser.add_argument('image_path', help='Path to the image file')
    parser.add_argument('-o', '--output', help='Output file path (if not provided, output to console)')
    
    args = parser.parse_args()
    
    # Check if file exists
    image_path = Path(args.image_path)
    if not image_path.exists():
        print(f"Error: File not found: {args.image_path}", file=sys.stderr)
        return 1
    
    # Convert image to base64
    base64_data = convert_image_to_base64(args.image_path)
    if not base64_data:
        return 1
    
    # Output base64 data
    if args.output:
        success = save_base64_to_file(base64_data, args.output)
        if not success:
            return 1
    else:
        print("\nBase64 Image Data:")
        print(base64_data[:100] + "..." if len(base64_data) > 100 else base64_data)
        print("\nTotal length:", len(base64_data))
        print("\nTo use with MCP server in multi_image_analysis:")
        print('''
{
  "images": [
    {
      "url": "''' + base64_data[:20] + '... (full base64 string)" ' + '''
    }
  ],
  "prompt": "Please describe this image in detail. What does it show?",
  "model": "qwen/qwen2.5-vl-32b-instruct:free"
}
''')
    
    return 0


if __name__ == "__main__":
    sys.exit(main()) 