import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class NotificationInterceptorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.settings = this.getSettings();
        this._rows = [];

        // --- Page 1: General ---
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        // Group 1: Global Settings
        const durationsGroup = new Adw.PreferencesGroup({
            title: _('Global Duration Defaults'),
            description: _('Default display duration based on urgency level (0 = persistent)'),
        });
        generalPage.add(durationsGroup);

        durationsGroup.add(this._createGlobalDurationRow('duration-low', _('Low Priority'), 5));
        durationsGroup.add(this._createGlobalDurationRow('duration-normal', _('Normal Priority'), 10));
        durationsGroup.add(this._createGlobalDurationRow('duration-critical', _('Critical Priority'), 0));

        // --- Page 2: Applications ---
        const appsPage = new Adw.PreferencesPage({
            title: _('Applications'),
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(appsPage);

        // Group 2: Management
        const actionGroup = new Adw.PreferencesGroup({
            title: _('Applications'),
        });
        appsPage.add(actionGroup);

        // Add App Button
        const addRow = new Adw.ActionRow({
            title: _('Add Application'),
            subtitle: _('Configure specific rules for an application'),
        });
        const addBtn = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
        });
        addBtn.connect('clicked', () => {
            this._showAppChooser(window);
        });
        addRow.add_suffix(addBtn);
        addRow.set_activatable_widget(addBtn);
        actionGroup.add(addRow);

        // Group 3: Configured Apps
        this.appsGroup = new Adw.PreferencesGroup({
            title: _('Configured Applications'),
        });
        appsPage.add(this.appsGroup);

        // Initial Load
        this._refreshAppList();

        // Listen for changes
        this.settings.connect('changed::app-configs', () => this._refreshAppList());
    }



    _createGlobalDurationRow(key, title, defaultValue) {
        const row = new Adw.ActionRow({
            title: title,
        });
        const spin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 3600,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        this.settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(spin);
        return row;
    }

    _refreshAppList() {
        // Clear existing rows
        // AdwPreferencesGroup doesn't have remove_all? It inherits from Gtk.Widget -> no, it manages rows.
        // We can mimic remove_all by getting children.
        // Or just destroy the group and recreate? No, better to remove children.
        // There isn't a direct "get_rows" API easily exposed usually.
        // Let's iterate over children using standard Gtk API.

        // Clear existing rows safely by collecting them first
        // Clear existing rows safely using tracked array
        if (this._rows) {
            this._rows.forEach(row => this.appsGroup.remove(row));
        }
        this._rows = [];

        const configs = this.settings.get_value('app-configs').recursiveUnpack();
        // configs is { "AppName": [enabled (bool), duration (int)], ... }

        if (Object.keys(configs).length === 0) {
            const emptyRow = new Adw.ActionRow({
                title: _('No applications configured'),
            });
            this.appsGroup.add(emptyRow);
            return;
        }

        for (const [appName, [enabled, duration]] of Object.entries(configs)) {
            const row = new Adw.ExpanderRow({
                title: appName,
                subtitle: enabled ? _('Enabled') : _('Disabled'),
            });

            // Enable Switch
            const enableRow = new Adw.ActionRow({
                title: _('Enable Notifications'),
            });
            const toggle = new Gtk.Switch({
                active: enabled,
                valign: Gtk.Align.CENTER,
            });
            toggle.connect('notify::active', () => {
                this._updateConfig(appName, toggle.active, durationSpin.get_value_as_int());
                const status = toggle.active ? _('Enabled') : _('Disabled');
                const dur = durationSpin.get_value_as_int();
                row.subtitle = `${status}, ${dur}s`;
            });
            // Initial subtitle
            const status = enabled ? _('Enabled') : _('Disabled');
            row.subtitle = `${status}, ${duration}s`;
            enableRow.add_suffix(toggle);
            row.add_row(enableRow);

            // Duration
            const durationRow = new Adw.ActionRow({
                title: _('Duration (seconds)'),
            });
            const durationSpin = new Gtk.SpinButton({
                adjustment: new Gtk.Adjustment({
                    lower: 1,
                    upper: 60,
                    step_increment: 1,
                    value: duration,
                }),
                valign: Gtk.Align.CENTER,
            });
            durationSpin.connect('value-changed', () => {
                const val = durationSpin.get_value_as_int();
                this._updateConfig(appName, toggle.active, val);
                const status = toggle.active ? _('Enabled') : _('Disabled');
                row.subtitle = `${status}, ${val}s`;
            });
            durationRow.add_suffix(durationSpin);
            row.add_row(durationRow);

            // Delete Button
            const deleteRow = new Adw.ActionRow({
                title: _('Remove Configuration'),
            });
            deleteRow.add_css_class('destructive-action');
            const deleteBtn = new Gtk.Button({
                label: _('Remove'),
                css_classes: ['destructive-action'],
                valign: Gtk.Align.CENTER,
            });
            deleteBtn.connect('clicked', () => {
                this._removeConfig(appName);
            });
            deleteRow.add_suffix(deleteBtn);
            row.add_row(deleteRow);

            this.appsGroup.add(row);
            this._rows.push(row);
        }
    }

    _updateConfig(appName, enabled, duration) {
        const configs = this.settings.get_value('app-configs').recursiveUnpack();
        configs[appName] = [enabled, duration];
        this.settings.set_value('app-configs', new GLib.Variant('a{s(bi)}', configs));
    }

    _removeConfig(appName) {
        const configs = this.settings.get_value('app-configs').recursiveUnpack();
        delete configs[appName];
        this.settings.set_value('app-configs', new GLib.Variant('a{s(bi)}', configs));
    }

    _showAppChooser(parentWindow) {
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
            this._showCustomAddDialog(parentWindow);
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
        const existingConfigs = this.settings.get_value('app-configs').recursiveUnpack();
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
                this._updateConfig(row._appName, true, 5);
                dialog.close();
            }
        });

        dialog.present();
    }

    _showCustomAddDialog(parent) {
        const dialog = new Gtk.Window({
            title: _('Add Custom Application'),
            modal: true,
            transient_for: parent || window,
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
                this._updateConfig(text, true, 5);
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
                this._updateConfig(text, true, 5);
                dialog.close();
            }
        });
        box.append(addBtn);

        dialog.present();
    }
}
