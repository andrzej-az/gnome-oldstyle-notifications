import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export function showAppChooser(parentWindow, settings, updateConfigCallback) {
    const dialog = new Gtk.Window({
        title: _('Select Application'),
        modal: true,
        transient_for: parentWindow,
        default_width: 400,
        default_height: 500,
        resizable: true,
    });

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    dialog.set_child(box);

    // Header
    const header = new Adw.HeaderBar();
    dialog.set_titlebar(header);

    // Custom App Button
    const customBtn = new Gtk.Button({
        tooltip_text: _('Add application by name'),
        icon_name: 'document-edit-symbolic',
    });
    customBtn.connect('clicked', () => {
        dialog.close();
        showCustomAddDialog(parentWindow, updateConfigCallback);
    });
    header.pack_end(customBtn);

    // Search
    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: _('Search...'),
        margin_start: 10,
        margin_end: 10,
        margin_top: 10,
        margin_bottom: 10,
    });
    box.append(searchEntry);

    // List
    const scrolled = new Gtk.ScrolledWindow({
        vexpand: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    box.append(scrolled);

    const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        css_classes: ['boxed-list'], // Adwaita style
        margin_start: 10,
        margin_end: 10,
        margin_bottom: 10,
    });
    scrolled.set_child(listBox);

    // Populate
    const existingConfigs = settings.get_value('app-configs').recursiveUnpack();
    const configuredNames = Object.keys(existingConfigs);

    const allApps = Gio.AppInfo.get_all().filter(app =>
        app.should_show() && !configuredNames.includes(app.get_name())
    );
    const rows = [];

    allApps.sort((a, b) => a.get_name().localeCompare(b.get_name()));

    allApps.forEach(app => {
        const row = new Adw.ActionRow({
            title: app.get_name(),
            activatable: true,
        });

        // Icon
        const icon = app.get_icon();
        if (icon) {
            const img = new Gtk.Image({
                gicon: icon,
                pixel_size: 32,
            });
            row.add_prefix(img);
        }

        row._appName = app.get_name(); // Store for retrieval
        row._appObj = app;

        rows.push(row);
        listBox.append(row);
    });

    // Search filter
    searchEntry.connect('search-changed', () => {
        const query = searchEntry.text.toLowerCase();
        rows.forEach(row => {
            const visible = row._appName.toLowerCase().includes(query);
            row.set_visible(visible);
        });
    });

    // Selection
    listBox.connect('row-activated', (list, row) => {
        if (row && row._appName) {
            // Add default config: Enabled=true, Duration=5
            updateConfigCallback(row._appName, true, 5);
            dialog.close();
        }
    });

    dialog.present();
}

export function showCustomAddDialog(parentWindow, updateConfigCallback) {
    const dialog = new Gtk.Window({
        title: _('Add Custom Application'),
        modal: true,
        transient_for: parentWindow, // Fixed ReferenceError by explicitly passing parentWindow
        default_width: 300,
        default_height: 150,
        resizable: false,
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 20,
        margin_bottom: 20,
        margin_start: 20,
        margin_end: 20,
        spacing: 10,
    });
    dialog.set_child(box);

    const label = new Gtk.Label({
        label: _('Enter the exact application name:'),
        halign: Gtk.Align.START,
    });
    box.append(label);

    const entry = new Gtk.Entry({
        placeholder_text: _('Application Name'),
    });
    entry.connect('activate', () => {
        const text = entry.get_text().trim();
        if (text) {
            updateConfigCallback(text, true, 5);
            dialog.close();
        }
    });
    box.append(entry);

    const addBtn = new Gtk.Button({
        label: _('Add'),
        halign: Gtk.Align.END,
        css_classes: ['suggested-action'],
    });
    addBtn.connect('clicked', () => {
        const text = entry.get_text().trim();
        if (text) {
            updateConfigCallback(text, true, 5);
            dialog.close();
        }
    });
    box.append(addBtn);

    dialog.present();
}
