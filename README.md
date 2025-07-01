# Nest Data Viewer

A beautiful web application to visualize and analyze your exported Nest thermostat HVAC runtime data.

## Features

- 📊 **Interactive Charts**: Visualize temperature trends, HVAC targets, humidity levels, and runtime data
- 🌡️ **Temperature Analysis**: Compare indoor vs outdoor temperatures over time
- 🎯 **Target Tracking**: See how your actual temperature compares to heating/cooling targets
- 💨 **Humidity Monitoring**: Track indoor and outdoor humidity levels
- ⚡ **Runtime Analysis**: Understand when your HVAC system was actively heating or cooling
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices
- 🎨 **Modern UI**: Clean, intuitive interface with smooth animations

## Getting Started

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Open your browser** and navigate to:
   ```
   http://localhost:3000
   ```

3. **Upload your data**:
   - Click "Choose JSONL File" 
   - Select your exported Nest HVAC runtime data file
   - The application will automatically parse and visualize your data

## Data Format

The application expects JSONL (JSON Lines) format where each line contains a JSON object with HVAC runtime data. Key fields include:

- `interval_start`: Timestamp for the data point
- `indoor_temp`: Indoor temperature reading
- `outdoor_temp`: Outdoor temperature reading  
- `cooling_target`: Target cooling temperature
- `heating_target`: Target heating temperature
- `indoor_humidity`: Indoor humidity percentage
- `outdoor_humidity`: Outdoor humidity percentage
- `cooling_time`: Time spent cooling (seconds)
- `heating_time`: Time spent heating (seconds)

## Charts Included

1. **Temperature Analysis**: Line chart showing indoor and outdoor temperature trends
2. **HVAC Target vs Actual**: Compares actual indoor temperature with heating/cooling targets
3. **Humidity Levels**: Tracks indoor and outdoor humidity over time
4. **HVAC Runtime**: Bar chart showing when your system was actively heating or cooling

## Technical Details

- **Frontend**: Vanilla JavaScript with Chart.js for visualizations
- **Backend**: Simple Node.js HTTP server
- **Charts**: Chart.js with time-series support
- **Styling**: Modern CSS with gradients and animations
- **Data Processing**: Client-side JSONL parsing with error handling

## Browser Compatibility

- Chrome (recommended)
- Firefox
- Safari
- Edge

## Troubleshooting

If you encounter issues:

1. **File won't upload**: Ensure your file is in JSONL format with valid JSON on each line
2. **Charts not displaying**: Check the browser console for errors and ensure your data has the required fields
3. **Server won't start**: Make sure port 3000 is available or modify the PORT variable in server.js

## Development

To modify the application:

- Edit `index.html` for UI changes
- Edit `app.js` for chart logic and data processing
- Edit `server.js` for server configuration

The application automatically handles the double-encoded JSON strings in your Nest export data.
