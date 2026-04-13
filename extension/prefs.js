import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { showAppChooser } from './settings-dialogs.js';

export default class OldstyleNotificationsPreferences extends ExtensionPreferences {
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
            showAppChooser(window, this.settings, this._updateConfig.bind(this));
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
}
