#!/usr/bin/env python3
import base64
import os
import mimetypes
import requests
from openai import OpenAI

# Constants
OPENROUTER_API_KEY = "your_openrouter_api_key"  # Replace with your actual key
IMAGE_PATH = "path/to/your/image.jpg"  # Replace with your image path

def image_to_base64(image_path):
    """Convert an image file to base64 with data URI prefix"""
    try:
        # Determine MIME type
        mime_type, _ = mimetypes.guess_type(image_path)
        if not mime_type:
            # Default to generic binary if type cannot be determined
            mime_type = "application/octet-stream"
        
        # Read and encode the image
        with open(image_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
        
        # Return data URI
        return f"data:{mime_type};base64,{encoded_string}"
    except Exception as e:
        print(f"Error converting image to base64: {e}")
        raise

def send_image_direct_api(base64_image, question="What's in this image?"):
    """Send an image to OpenRouter using direct API call"""
    try:
        print("Sending image via direct API call...")
        
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://your-site-url.com",  # Optional
            "X-Title": "Your Site Name"  # Optional
        }
        
        payload = {
            "model": "anthropic/claude-3-opus",  # Choose an appropriate model with vision capabilities
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": question
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": base64_image
                            }
                        }
                    ]
                }
            ]
        }
        
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload
        )
        
        response.raise_for_status()  # Raise exception for non-200 responses
        data = response.json()
        
        print("Response from direct API:")
        print(data["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"Error sending image via direct API: {e}")
        if hasattr(e, "response") and e.response:
            print(f"API error details: {e.response.text}")

def send_image_openai_sdk(base64_image, question="What's in this image?"):
    """Send an image to OpenRouter using OpenAI SDK"""
    try:
        print("Sending image via OpenAI SDK...")
        
        # Initialize the OpenAI client with OpenRouter base URL
        client = OpenAI(
            api_key=OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://your-site-url.com",  # Optional
                "X-Title": "Your Site Name"  # Optional
            }
        )
        
        # Create the message with text and image
        completion = client.chat.completions.create(
            model="anthropic/claude-3-opus",  # Choose an appropriate model with vision capabilities
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": question
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": base64_image
                            }
                        }
                    ]
                }
            ]
        )
        
        print("Response from OpenAI SDK:")
        print(completion.choices[0].message.content)
    except Exception as e:
        print(f"Error sending image via OpenAI SDK: {e}")

def send_image_from_base64_file(base64_file_path, question="What's in this image?"):
    """Use a pre-encoded base64 file (e.g., from bash script)"""
    try:
        print("Sending image from base64 file...")
        
        # Read the base64 data from file
        with open(base64_file_path, "r") as file:
            base64_data = file.read().strip()
        
        # Initialize the OpenAI client
        client = OpenAI(
            api_key=OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1"
        )
        
        # Create the message with text and image
        completion = client.chat.completions.create(
            model="anthropic/claude-3-opus",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": question
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": base64_data
                            }
                        }
                    ]
                }
            ]
        )
        
        print("Response when using base64 file:")
        print(completion.choices[0].message.content)
    except Exception as e:
        print(f"Error sending image from base64 file: {e}")

def main():
    try:
        # Convert the image to base64
        base64_image = image_to_base64(IMAGE_PATH)
        print("Image converted to base64 successfully")
        
        # Example 1: Using direct API call
        send_image_direct_api(base64_image)
        
        # Example 2: Using OpenAI SDK
        send_image_openai_sdk(base64_image)
        
        # Example 3: Using a base64 file (if you have one)
        # send_image_from_base64_file("path/to/base64.txt")
        
    except Exception as e:
        print(f"Error in main function: {e}")

if __name__ == "__main__":
    main() 