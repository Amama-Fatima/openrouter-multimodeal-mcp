// Load environment variables and start the MCP server
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to .env file
const envPath = path.join(__dirname, '.env');

async function loadEnvAndStartServer() {
  try {
    console.log('Loading environment variables from .env file...');
    
    // Read .env file
    const envContent = await fs.readFile(envPath, 'utf8');
    
    // Parse .env file and set environment variables
    const envVars = {};
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        
        // Remove quotes if they exist
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/^"|"$/g, '');
        }
        
        envVars[key] = value;
        process.env[key] = value;
      }
    });
    
    console.log('Environment variables loaded successfully');
    console.log(`API Key found: ${process.env.OPENROUTER_API_KEY ? 'Yes' : 'No'}`);
    
    // Start the server process with environment variables
    console.log('Starting MCP server...');
    const serverProcess = spawn('node', ['dist/index.js'], {
      env: { ...process.env, ...envVars },
      stdio: 'inherit'
    });
    
    // Handle server process events
    serverProcess.on('close', (code) => {
      console.log(`MCP server exited with code ${code}`);
    });
    
    serverProcess.on('error', (err) => {
      console.error('Failed to start MCP server:', err);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the function
loadEnvAndStartServer(); 