#!/bin/bash

# Extension UUID
UUID="oldstyle-notifications@andrzej.az"
# Path to the extension source
SRC_DIR="extension"
# Path to the GNOME Shell extensions directory
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Building and installing $UUID..."

# Compile schemas
echo "Compiling schemas..."
if [ -d "$SRC_DIR/schemas" ]; then
    glib-compile-schemas "$SRC_DIR/schemas/"
fi

# Create destination directory
mkdir -p "$DEST_DIR"

# Copy files
echo "Copying files to $DEST_DIR..."
cp -r "$SRC_DIR"/* "$DEST_DIR/"

echo "Installation complete!"
echo "To enable the extension, run:"
echo "  gnome-extensions enable $UUID"
echo ""
echo "Note: If you are on X11, you may need to restart GNOME Shell (Alt+F2, then type 'r' and Enter)."
echo "If you are on Wayland, you may need to log out and log back in for changes to take effect."
